/** Throw from services/routes; the error handler renders it as problem+json (RFC 9457). */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly title: string,
    public readonly detail?: string,
  ) {
    super(detail ?? title);
    this.name = 'AppError';
  }

  static notFound(what: string) {
    return new AppError(404, 'not_found', 'Not found', `${what} was not found`);
  }
  static conflict(code: string, detail: string) {
    return new AppError(409, code, 'Conflict', detail);
  }
  static unprocessable(code: string, detail: string) {
    return new AppError(422, code, 'Unprocessable', detail);
  }
  static forbidden(detail = 'You are not allowed to do this') {
    return new AppError(403, 'forbidden', 'Forbidden', detail);
  }
}

export const problemType = (code: string) => `urn:kejasha:problem:${code}`;
