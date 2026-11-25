/** An error caused by the request, safe to show to the user. */
export class UserError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 404 | 409 = 400,
  ) {
    super(message);
    this.name = 'UserError';
  }
}

export const READONLY_ERROR = 'redisdeck is running in --readonly mode';
