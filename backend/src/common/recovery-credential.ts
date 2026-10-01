import { randomBytes } from 'node:crypto';
import { hashPassword, verifyPassword } from './password';

export const PASSWORD_RECOVERY_TTL_MINUTES = 30;
const RECOVERY_MIN_LENGTH = 16;
const RECOVERY_MAX_LENGTH = 256;

export function generateRecoveryCredential() {
  return randomBytes(24).toString('base64url');
}

export function assertRecoveryCredentialPolicy(value: string) {
  const credential = String(value ?? '');
  const length = Array.from(credential).length;
  if (length < RECOVERY_MIN_LENGTH || length > RECOVERY_MAX_LENGTH || /[\u0000-\u001f\u007f]/u.test(credential)) {
    throw new Error('Временный код должен содержать от 16 до 256 символов без управляющих символов.');
  }
}

export function hashRecoveryCredential(value: string) {
  assertRecoveryCredentialPolicy(value);
  return hashPassword(value);
}

export function verifyRecoveryCredential(value: string, storedHash: string | null | undefined) {
  if (!storedHash) return false;
  return verifyPassword(value, storedHash);
}

export function recoveryCredentialExpiresAt(now = new Date(), ttlMinutes = PASSWORD_RECOVERY_TTL_MINUTES) {
  if (!Number.isInteger(ttlMinutes) || ttlMinutes < 5 || ttlMinutes > 24 * 60) {
    throw new Error('Срок временного кода должен быть от 5 минут до 24 часов.');
  }
  return new Date(now.getTime() + ttlMinutes * 60 * 1000);
}
