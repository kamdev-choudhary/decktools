/** An error caused by the request, safe to show to the user. */
export class UserError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 404 | 409 | 413 = 400,
  ) {
    super(message);
    this.name = 'UserError';
  }
}
