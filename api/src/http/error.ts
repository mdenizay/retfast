import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const notFound: RequestHandler = (_request, _response, next) => {
  next(new ApiError(404, "not_found", "Route not found."));
};

export const errorHandler: ErrorRequestHandler = (
  error,
  request,
  response,
  _next,
) => {
  if (error instanceof ZodError) {
    response.status(400).json({
      error: {
        code: "validation_error",
        message: "The request payload is invalid.",
        details: error.issues,
        requestId: request.id,
      },
    });
    return;
  }
  const apiError = error instanceof ApiError
    ? error
    : new ApiError(500, "internal_error", "An unexpected error occurred.");
  if (apiError.status >= 500) request.log.error({ err: error }, apiError.message);
  response.status(apiError.status).json({
    error: {
      code: apiError.code,
      message: apiError.message,
      ...(apiError.details === undefined ? {} : { details: apiError.details }),
      requestId: request.id,
    },
  });
};
