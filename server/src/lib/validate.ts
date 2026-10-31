import type { z } from "zod";
import { HttpError } from "./errors.js";

export function parse<S extends z.ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const res = schema.safeParse(data);
  if (!res.success) {
    const first = res.error.issues[0];
    const where = first?.path.length ? `${first.path.join(".")}: ` : "";
    throw new HttpError(400, `${where}${first?.message ?? "Некорректные данные"}`);
  }
  return res.data;
}
