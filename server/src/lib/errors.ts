export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** `notFound("Папка", "f")` → "Папка не найдена"; grammatical gender keeps messages natural in Russian. */
export const notFound = (what = "Объект", gender: "m" | "f" = "m") => new HttpError(404, `${what} не найден${gender === "f" ? "а" : ""}`);
export const forbidden = () => new HttpError(403, "Недостаточно прав");
export const badRequest = (msg: string) => new HttpError(400, msg);
export const conflict = (msg: string) => new HttpError(409, msg);

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
