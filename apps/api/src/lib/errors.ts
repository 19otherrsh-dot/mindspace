/** Errors thrown anywhere in a request are translated by the error middleware. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, string>,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const badRequest = (message: string, details?: Record<string, string>) =>
  new HttpError(400, 'bad_request', message, details);

export const unauthorized = (message = 'Authentication required') =>
  new HttpError(401, 'unauthorized', message);

/** Used specifically for Pro-gated content so the client can open the paywall. */
export const paywall = (message = 'This content requires Mindspace Pro') =>
  new HttpError(402, 'subscription_required', message);

export const forbidden = (message = 'Not permitted') =>
  new HttpError(403, 'forbidden', message);

export const notFound = (what = 'Resource') =>
  new HttpError(404, 'not_found', `${what} not found`);

export const conflict = (message: string) => new HttpError(409, 'conflict', message);

export const tooManyRequests = (message = 'Too many requests, please slow down') =>
  new HttpError(429, 'rate_limited', message);
