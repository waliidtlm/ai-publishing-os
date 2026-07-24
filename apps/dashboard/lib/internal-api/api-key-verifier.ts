import { createHash, timingSafeEqual } from "node:crypto";

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

export function verifyInternalApiKey(
  submittedKey: string,
  expectedKey: string,
): boolean {
  return timingSafeEqual(digest(submittedKey), digest(expectedKey));
}
