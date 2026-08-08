import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/schema.ts",
  out: "./migrations",
  dialect: "postgresql",
  // Only used by `drizzle-kit push`. We apply migrations via src/migrate.ts.
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://mezo:mezo@localhost:5432/mezo_monitor",
  },
  verbose: true,
  strict: true,
});
