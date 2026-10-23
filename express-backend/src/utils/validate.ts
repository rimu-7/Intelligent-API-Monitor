import type { z } from "zod";
import { ApiError } from "./api-error.js";

/** Parse untrusted input with a zod schema, throwing a 422 with field-level errors. */
export const validate = <T extends z.ZodType>(schema: T, input: unknown): z.infer<T> => {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw ApiError.validation(
      result.error.issues.map((issue) => ({
        field: issue.path.join(".") || null,
        message: issue.message,
      })),
    );
  }
  return result.data;
};
