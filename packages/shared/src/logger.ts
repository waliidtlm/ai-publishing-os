import pino, { type Logger } from "pino";

export interface LoggerConfiguration {
  level?: string;
  service: string;
}

const redactedPaths = [
  "authorization",
  "cookie",
  "password",
  "req.headers.authorization",
  "req.headers.cookie",
  "request.headers.authorization",
  "request.headers.cookie",
  "*.password",
  "*.secret",
  "*.token",
  "*.apiKey",
];

export function createLogger({
  level = "info",
  service,
}: LoggerConfiguration): Logger {
  return pino({
    base: {
      service,
    },
    level,
    redact: {
      paths: redactedPaths,
      censor: "[REDACTED]",
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}
