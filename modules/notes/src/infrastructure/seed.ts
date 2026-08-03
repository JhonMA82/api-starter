import type { Db } from "./db";
import { notes } from "./note.schema";

function seedRow(
  id: string,
  title: string,
  body: string,
  pinned: boolean,
): typeof notes.$inferInsert {
  return { id, title, body, pinned };
}

export const SEED_NOTES: (typeof notes.$inferInsert)[] = [
  seedRow(
    "11111111-1111-4111-8111-111111111111",
    "Welcome",
    "Welcome to the reusable API starter.",
    true,
  ),
  seedRow(
    "22222222-2222-4222-8222-222222222222",
    "Run the stack",
    "bun run db:up && bun run db:migrate && bun run db:seed",
    false,
  ),
  seedRow(
    "33333333-3333-4333-8333-333333333333",
    "Layering",
    "domain ← application ← infrastructure; driver types never leave infrastructure.",
    false,
  ),
];

export async function seedNotes(db: Db): Promise<number> {
  const inserted = await db
    .insert(notes)
    .values(SEED_NOTES)
    .onConflictDoNothing({ target: notes.id })
    .returning({ id: notes.id });
  return inserted.length;
}
