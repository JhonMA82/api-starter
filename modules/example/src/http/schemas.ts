import { z } from "zod";

export const HelloQuery = z.object({
  name: z.string().min(1).max(50),
});

export const HelloResponse = z.object({
  message: z.string(),
});
