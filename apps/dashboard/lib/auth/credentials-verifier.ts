import { createHash, timingSafeEqual } from "node:crypto";

export interface ExpectedDevelopmentCredentials {
  email: string;
  password: string;
}

export interface SubmittedDevelopmentCredentials {
  email: string;
  password: string;
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function constantTimeEqual(actual: string, expected: string): boolean {
  return timingSafeEqual(digest(actual), digest(expected));
}

export function verifyDevelopmentCredentials(
  submitted: SubmittedDevelopmentCredentials,
  expected: ExpectedDevelopmentCredentials,
): boolean {
  const submittedEmail = submitted.email.trim().toLowerCase();
  const expectedEmail = expected.email.trim().toLowerCase();

  const emailMatches = constantTimeEqual(submittedEmail, expectedEmail);
  const passwordMatches = constantTimeEqual(
    submitted.password,
    expected.password,
  );

  return emailMatches && passwordMatches;
}
