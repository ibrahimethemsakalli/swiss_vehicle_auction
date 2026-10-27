import 'dotenv/config';
import { publishLegal } from '../src/lib/legal';
import { legalProfile } from '../src/lib/legal-policy';
import { db } from '../src/lib/db';
const [version, reviewed, ...extra] = process.argv.slice(2);
if (!version || reviewed !== '--reviewed' || extra.length)
  throw Error(
    'Usage: publish-legal.ts VERSION --reviewed; complete and review legal-profile.json and all four document texts first.',
  );
publishLegal(version, legalProfile)
  .then((result) => console.log(JSON.stringify(result)))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : 'Legal publication failed');
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
