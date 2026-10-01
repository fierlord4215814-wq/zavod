import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const KEY_LENGTH = 64;
const PASSWORD_MIN_LENGTH = 6;
const PASSWORD_MAX_LENGTH = 128;

export class PasswordPolicyError extends Error {
  constructor(
    readonly code: 'PASSWORD_TOO_SHORT' | 'PASSWORD_TOO_LONG' | 'PASSWORD_INVALID_CHARACTERS',
    message: string,
  ) {
    super(message);
    this.name = 'PasswordPolicyError';
  }
}

export function normalizePhone(phone: string) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length === 10 && digits.startsWith('9')) return `+7${digits}`;
  if (digits.length === 11 && (digits.startsWith('7') || digits.startsWith('8'))) return `+7${digits.slice(1)}`;
  return '';
}

export function phoneLookupCandidates(phone: string) {
  const canonical = normalizePhone(phone);
  return canonical ? [canonical, canonical.slice(1)] : [];
}

export function normalizePhoneSearchDigits(phone: unknown) {
  const digits = String(phone ?? '').replace(/\D/g, '');
  if (digits.length === 10 && digits.startsWith('9')) return `7${digits}`;
  if (digits.length === 11 && digits.startsWith('8')) return `7${digits.slice(1)}`;
  return digits;
}

export function hashPassword(password: string) {
  const salt = randomBytes(16).toString('base64url');
  const hash = scryptSync(password, salt, KEY_LENGTH).toString('base64url');
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password: string, storedHash: string | null | undefined) {
  if (!storedHash) return false;
  const [scheme, salt, hash] = storedHash.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const actual = Buffer.from(scryptSync(password, salt, KEY_LENGTH).toString('base64url'));
  const expected = Buffer.from(hash);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function assertPasswordPolicy(password: string) {
  const value = String(password ?? '');
  const length = Array.from(value).length;
  if (length < PASSWORD_MIN_LENGTH) {
    throw new PasswordPolicyError(
      'PASSWORD_TOO_SHORT',
      `Пароль должен содержать не менее ${PASSWORD_MIN_LENGTH} символов. Можно использовать парольную фразу.`,
    );
  }
  if (length > PASSWORD_MAX_LENGTH) {
    throw new PasswordPolicyError(
      'PASSWORD_TOO_LONG',
      `Пароль должен содержать не более ${PASSWORD_MAX_LENGTH} символов.`,
    );
  }
  if (!value.trim() || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new PasswordPolicyError(
      'PASSWORD_INVALID_CHARACTERS',
      'Пароль не должен состоять из пробелов или содержать управляющие символы.',
    );
  }
}

export function maskPhone(normalizedPhone: string) {
  const canonical = normalizePhone(normalizedPhone);
  if (!canonical) return '****';
  return `${canonical.slice(0, 2)} *** ***-${canonical.slice(-4, -2)}-${canonical.slice(-2)}`;
}
