// Single error model + envelope. All failures (thrown ApiError, schema-validation, not-found,
// unexpected) are funneled into { error: { code, message, details? } } with a conventional status.
// Per lock #6: details are allowed for validation errors and /health/ready; omitted for 500/internal.

import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

export type ErrorDetails = Record<string, unknown>;

export class ApiError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly details: ErrorDetails | undefined;

  constructor(statusCode: number, code: string, message: string, details?: ErrorDetails) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (code: string, message: string, details?: ErrorDetails): ApiError =>
  new ApiError(400, code, message, details);

export const invalidQuery = (message: string, details?: ErrorDetails): ApiError =>
  badRequest('invalid_query', message, details);

export const invalidCursor = (message = 'invalid cursor'): ApiError =>
  badRequest('invalid_cursor', message);

export const invalidHeight = (message = 'invalid height'): ApiError =>
  badRequest('invalid_height', message);

export const notFound = (message: string): ApiError => new ApiError(404, 'not_found', message);

interface ErrorBody {
  error: { code: string; message: string; details?: ErrorDetails };
}

function body(code: string, message: string, details?: ErrorDetails): ErrorBody {
  return details === undefined
    ? { error: { code, message } }
    : { error: { code, message, details } };
}

/** Wire the central error + not-found handlers into a Fastify instance. */
export function registerErrorHandling(app: FastifyInstance): void {
  app.setNotFoundHandler((_request: FastifyRequest, reply: FastifyReply) => {
    reply.code(404).send(body('not_found', 'resource not found'));
  });

  app.setErrorHandler((error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
    if (error instanceof ApiError) {
      reply.code(error.statusCode).send(body(error.code, error.message, error.details));
      return;
    }

    // Fastify schema validation failure -> 400 invalid_query (details carry the field errors).
    if (error.validation) {
      reply.code(400).send(
        body('invalid_query', 'request validation failed', { validation: error.validation }),
      );
      return;
    }

    // @fastify/rate-limit throws a 429 (not an ApiError); surface it in the standard envelope.
    if (error.statusCode === 429) {
      reply.code(429).send(body('rate_limited', error.message || 'rate limit exceeded'));
      return;
    }

    // Anything else is unexpected: log the cause, return a generic 500 with NO details.
    request.log.error(error);
    reply.code(500).send(body('internal', 'internal server error'));
  });
}
