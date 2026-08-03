import { ERROR_CODES } from "@consulting/core";
import { z } from "zod";

export const ProblemDetailsSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  code: z.enum(ERROR_CODES),
  detail: z.string().optional(),
  instance: z.string().optional(),
  requestId: z.string(),
  errors: z.array(z.object({ field: z.string(), message: z.string() })).optional(),
});
export type ProblemDetails = z.infer<typeof ProblemDetailsSchema>;
