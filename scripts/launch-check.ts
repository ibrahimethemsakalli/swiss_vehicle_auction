import 'dotenv/config';
import { launchEnvironmentIssues } from '../src/lib/launch-gate';
import { readLaunchDatabase } from '../src/lib/launch-database';
import { db } from '../src/lib/db';

// This command never changes flags, publishes legal text, deletes fixtures or starts workers.
const issues = launchEnvironmentIssues(process.env);
let database: Awaited<ReturnType<typeof readLaunchDatabase>> | undefined;
try {
  if (process.argv.includes('--database')) {
    try {
      database = await readLaunchDatabase(db, process.env);
      issues.push(...database.issues);
    } catch {
      issues.push('DATABASE_CHECK_FAILED');
    }
  } else issues.push('DATABASE_NOT_CHECKED');
  console.log(
    JSON.stringify(
      {
        scope: 'L19 technical preflight only; not provider or production acceptance',
        target: process.env.LAUNCH_MODE ?? 'unset',
        ready: process.env.LAUNCH_MODE === 'public' && issues.length === 0,
        issues,
        counts: database?.counts,
      },
      null,
      2,
    ),
  );
  process.exitCode = issues.length || process.env.LAUNCH_MODE !== 'public' ? 1 : 0;
} finally {
  await db.$disconnect();
}
