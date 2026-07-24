import { describe, expect, it } from "vitest";

import { verifyInternalApiKey } from "../lib/internal-api/api-key-verifier";

describe("verifyInternalApiKey", () => {
  const expectedKey = "expected-internal-api-key-with-32-characters";

  it("accepts the configured key", () => {
    expect(verifyInternalApiKey(expectedKey, expectedKey)).toBe(true);
  });

  it("rejects a different key", () => {
    expect(
      verifyInternalApiKey(
        "different-internal-api-key-with-32-characters",
        expectedKey,
      ),
    ).toBe(false);
  });
});
