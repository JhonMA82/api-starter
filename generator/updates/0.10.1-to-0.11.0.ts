import type { PlannedOperation, Update, UpdateContext } from "./registry";

export const update: Update = {
  id: "0.10.1-to-0.11.0",
  from: "0.10.1",
  to: "0.11.0",
  appliesTo: [],
  reversible: true,
  breakingNotes:
    "Granular profiles and manifest introduction. No breaking changes; multi-tenant deprecated.",
  plan(_context: UpdateContext): PlannedOperation[] {
    return [];
  },
};
