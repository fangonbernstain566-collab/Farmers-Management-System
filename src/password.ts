import bcrypt from "bcryptjs";
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}
export async function verifyPassword(
  password: string,
  hash: string,
): Promise<boolean> {
  if (!/^\$2[aby]\$/.test(hash)) return false;
  return bcrypt.compare(password, hash.replace(/^\$2y\$/, "$2b$"));
}
export function needsRehash(hash: string): boolean {
  return /^\$2[aby]\$/.test(hash) && bcrypt.getRounds(hash) < 12;
}
