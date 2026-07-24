import { describe, expect, it } from "vitest";

import { verifyDevelopmentCredentials } from "../lib/auth/credentials-verifier";

const expected = {
  email: "developer@example.com",
  password: "development-password",
};

describe("verifyDevelopmentCredentials", () => {
  it("accepts the configured development credentials", () => {
    expect(
      verifyDevelopmentCredentials(
        {
          email: " Developer@Example.com ",
          password: "development-password",
        },
        expected,
      ),
    ).toBe(true);
  });

  it("rejects a wrong email", () => {
    expect(
      verifyDevelopmentCredentials(
        {
          email: "attacker@example.com",
          password: "development-password",
        },
        expected,
      ),
    ).toBe(false);
  });

  it("rejects a wrong password", () => {
    expect(
      verifyDevelopmentCredentials(
        {
          email: "developer@example.com",
          password: "wrong-password",
        },
        expected,
      ),
    ).toBe(false);
  });
});
