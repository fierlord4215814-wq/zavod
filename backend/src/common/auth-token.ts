import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export type TokenPayload = {
  userId: string;
  purpose?: 'auth' | 'password-setup';
  iat: number;
  exp: number;
  authEpoch?: number;
};

const processLocalSecret = randomBytes(32).toString('base64url');

export function nextAuthEpoch(previous: Date | null | undefined, now = Date.now()): Date {
  return new Date(Math.max(now, (previous?.getTime() ?? 0) + 1));
}

function base64Url(input: Buffer | string) {
  return Buffer.from(input).toString('base64url');
}

function secret() {
  return process.env.JWT_SECRET || process.env.SESSION_SECRET || processLocalSecret;
}

export function signAuthToken(
  userId: string,
  ttlSeconds = 24 * 60 * 60,
  purpose: TokenPayload['purpose'] = 'auth',
  authEpoch?: number,
) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64Url(JSON.stringify({
    userId,
    purpose,
    iat: issuedAt,
    exp: issuedAt + ttlSeconds,
    ...(Number.isFinite(authEpoch) ? { authEpoch } : {}),
  }));
  const signature = createHmac('sha256', secret()).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}

export function verifyAuthToken(token: string | undefined, expectedPurpose: TokenPayload['purpose'] = 'auth'): TokenPayload | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts;
  const expected = createHmac('sha256', secret()).update(`${header}.${payload}`).digest('base64url');
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(signature);
  if (expectedBuffer.length !== actualBuffer.length || !timingSafeEqual(expectedBuffer, actualBuffer)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as TokenPayload;
    if (parsed.purpose !== expectedPurpose) return null;
    if (!parsed.userId || !parsed.iat || parsed.exp < Math.floor(Date.now() / 1000)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function bearerToken(value: string | string[] | undefined) {
  const header = Array.isArray(value) ? value[0] : value;
  if (!header?.startsWith('Bearer ')) return undefined;
  return header.slice('Bearer '.length).trim();
}
