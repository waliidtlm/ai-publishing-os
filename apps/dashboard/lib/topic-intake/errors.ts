export class IntakeResourceNotFoundError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "IntakeResourceNotFoundError";
    this.code = code;
  }
}

export class InactiveSourceConfigurationError extends Error {
  constructor() {
    super("The source configuration is inactive.");
    this.name = "InactiveSourceConfigurationError";
  }
}

export class IdempotencyConflictError extends Error {
  constructor() {
    super("The idempotency key was already used with different request data.");
    this.name = "IdempotencyConflictError";
  }
}
