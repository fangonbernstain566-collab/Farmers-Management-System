export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function requireRecord<T>(value: T | undefined): T {
  if (!value) throw new HttpError(404, "The record could not be found.");
  return value;
}
