import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  // Generate/validate also work in the DB-free build environment. Migration commands
  // require this URL; no fallback to a developer or production database is provided.
  datasource: { url: process.env.DATABASE_URL || undefined },
});
