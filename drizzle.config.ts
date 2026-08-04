import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: [
    "./modules/notes/src/infrastructure/note.schema.ts",
    "./packages/auth/src/auth.schema.ts",
    "./packages/audit/src/audit.schema.ts",
    "./modules/organizations/src/infrastructure/organization.schema.ts",
    "./modules/organizations/src/infrastructure/api-key.schema.ts",
    "./modules/organizations/src/infrastructure/outbox.schema.ts",
    "./modules/organizations/src/infrastructure/webhook.schema.ts",
    "./modules/organizations/src/infrastructure/incoming-webhook.schema.ts",
    "./modules/jobs/src/infrastructure/job.schema.ts",
    "./modules/files/src/infrastructure/file.schema.ts",
    "./modules/notifications/src/infrastructure/sent-mail.schema.ts",
  ],
  out: "./migrations",
  strict: true,
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/api",
  },
});
