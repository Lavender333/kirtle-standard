import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
export const ttl = 8 * 60 * 60 * 1000;
export const token = () => randomBytes(32).toString('hex');
export const digest = value => createHash('sha256').update(value).digest('hex');
export function passwordHash(password) {
  const salt = randomBytes(16).toString('hex');
  return salt + ':' + scryptSync(password, salt, 64, {
    N: 32768,
    maxmem: 64 * 1024 * 1024
  }).toString('hex');
}
export function verify(password, stored) {
  const [salt, hash] = stored.split(':');
  const actual = scryptSync(password, salt, 64, {
    N: 32768,
    maxmem: 64 * 1024 * 1024
  });
  return timingSafeEqual(actual, Buffer.from(hash, 'hex'));
}
export function fail(status, message) {
  throw Object.assign(new Error(message), {
    status
  });
}
export function validUsername(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_]{3,32}$/.test(value)) fail(400, 'Use 3–32 letters, numbers, or underscores for your username.');
  return value;
}
export function validPassword(value) {
  if (typeof value !== 'string' || value.length < 8 || value.length > 128) fail(400, 'Use a password between 8 and 128 characters.');
  return value;
}
export async function createAccount(db, username, password, role) {
  validUsername(username);
  validPassword(password);
  if (!['owner', 'admin'].includes(role)) fail(400, 'Invalid role.');
  return await db.prepare('INSERT INTO users (username,password_hash,role,created_at) VALUES (?,?,?,?)').run(username, passwordHash(password), role, Date.now());
}
export const publicUser = u => ({
  id: u.id,
  username: u.username,
  role: u.role,
  disabled: !!u.disabled,
  createdAt: u.created_at
});
