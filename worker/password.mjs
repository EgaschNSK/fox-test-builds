import { randomBytes, timingSafeEqual, createHash } from "node:crypto";

// These are 192-bit machine-generated credentials, not human-chosen passwords.
// A fast salted hash is appropriate for random secrets (as for API keys).
// Never reuse this format to store ordinary passwords or lower their entropy.
export const createPassword = () =>
  `fox_${randomBytes(24).toString("base64url")}`;
const valid = (password) =>
  typeof password === "string" && /^fox_[A-Za-z0-9_-]{32}$/.test(password);
const derive = (password, salt) =>
  createHash("sha256")
    .update("fox-test-builds:credential:v1\0")
    .update(salt)
    .update(password)
    .digest();
export const DUMMY_HASH = `random192-sha256:${"0".repeat(32)}:${"0".repeat(64)}`;
export async function hashPassword(password) {
  if (!valid(password))
    throw new Error(
      "Only machine-generated credentials are supported. Use createPassword().",
    );
  const salt = randomBytes(16);
  return `random192-sha256:${salt.toString("hex")}:${derive(password, salt).toString("hex")}`;
}
export async function verifyPassword(password, encoded) {
  const match = /^random192-sha256:([a-f0-9]{32}):([a-f0-9]{64})$/.exec(
    encoded,
  );
  if (!match) throw new Error("Invalid stored credential hash");
  if (!valid(password)) return false;
  return timingSafeEqual(
    derive(password, Buffer.from(match[1], "hex")),
    Buffer.from(match[2], "hex"),
  );
}
export const token = () => randomBytes(32).toString("base64url");
export const digest = (value) =>
  createHash("sha256").update(value).digest("hex");
