import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
const derive = promisify(scrypt);
export async function hashPassword(password, salt = randomBytes(16).toString("hex")) {
  const hash = await derive(password, salt, 64);
  return `scrypt$${salt}$${hash.toString("hex")}`;
}
export async function verifyPassword(password, encoded) {
  if (
    typeof password !== "string" ||
    password.length > 256 ||
    !/^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$/.test(encoded)
  )
    return false;
  const [, salt, expected] = encoded.split("$");
  const actual = await derive(password, salt, 64);
  return timingSafeEqual(actual, Buffer.from(expected, "hex"));
}
