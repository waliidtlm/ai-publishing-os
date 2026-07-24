import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

export interface InternalApiErrorBody {
  error: {
    code: string;
    fields?: Array<{
      message: string;
      path: string;
    }>;
    message: string;
    retryable?: boolean;
  };
  success: false;
}

export function correlationIdFor(request: Request): string {
  const supplied = request.headers.get("x-request-id");

  if (supplied && /^[A-Za-z0-9._-]{1,100}$/u.test(supplied)) {
    return supplied;
  }

  return randomUUID();
}

export function internalJsonResponse(
  body: unknown,
  status: number,
  correlationId: string,
  additionalHeaders: HeadersInit = {},
) {
  return NextResponse.json(body, {
    headers: {
      "Cache-Control": "no-store",
      "X-Request-Id": correlationId,
      ...additionalHeaders,
    },
    status,
  });
}

export function internalErrorResponse(
  status: number,
  code: string,
  message: string,
  correlationId: string,
  options: {
    additionalHeaders?: HeadersInit;
    fields?: InternalApiErrorBody["error"]["fields"];
    retryable?: boolean;
  } = {},
) {
  return internalJsonResponse(
    {
      error: {
        code,
        ...(options.fields ? { fields: options.fields } : {}),
        message,
        ...(options.retryable !== undefined
          ? { retryable: options.retryable }
          : {}),
      },
      success: false,
    } satisfies InternalApiErrorBody,
    status,
    correlationId,
    options.additionalHeaders,
  );
}
