import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import type { ApiError } from '@mindspace/shared';
import { HttpError } from '../lib/errors.ts';
import { isProduction } from '../config.ts';

export function notFoundHandler(req: Request, res: Response) {
  const body: ApiError = {
    error: { code: 'not_found', message: `No route for ${req.method} ${req.path}` },
  };
  res.status(404).json(body);
}

// Express identifies error middleware by arity, so `next` must stay declared.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    const body: ApiError = {
      error: { code: err.code, message: err.message, details: err.details },
    };
    return res.status(err.status).json(body);
  }

  if (err instanceof ZodError) {
    const details: Record<string, string> = {};
    for (const issue of err.issues) {
      details[issue.path.join('.') || '_'] = issue.message;
    }
    const body: ApiError = {
      error: { code: 'validation_failed', message: 'Request validation failed', details },
    };
    return res.status(400).json(body);
  }

  // Unique-violation on a signup race reads better as a conflict than a 500.
  if (typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505') {
    const body: ApiError = {
      error: { code: 'conflict', message: 'That record already exists' },
    };
    return res.status(409).json(body);
  }

  console.error(`[api] unhandled error on ${req.method} ${req.path}`, err);

  const body: ApiError = {
    error: {
      code: 'internal_error',
      // Never leak stack traces or driver messages to clients in production.
      message: isProduction ? 'Something went wrong on our end' : developmentMessage(err),
    },
  };
  res.status(500).json(body);
}

/**
 * Some errors carry an empty `message` — AggregateError from a failed database
 * connection is the common one — which produced a blank 500 body that said
 * nothing. Fall back to the name and code so development output is actionable.
 */
function developmentMessage(err: unknown): string {
  const error = err as { message?: string; name?: string; code?: string };
  if (error?.message) return error.message;

  const parts = [error?.name, error?.code].filter(Boolean);
  return parts.length > 0 ? parts.join(': ') : 'Unknown error';
}
