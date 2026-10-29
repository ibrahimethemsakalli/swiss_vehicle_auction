import { open } from 'node:fs/promises';
import { previewSyntheticEvidence } from '../src/lib/refund-external-evidence';
// Offline local JSON preview. No DB, auth, SDK, upload or network import.
async function main() {
  const path = process.argv[2];
  if (!path || process.argv.length !== 3)
    throw Error('Usage: node --import tsx scripts/refund-evidence-preview.ts FILE.json');
  const file = await open(path, 'r');
  let content: string;
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > 2 * 1024 * 1024) throw Error('INPUT_LIMIT');
    const buffer = Buffer.alloc(2 * 1024 * 1024 + 1);
    let used = 0;
    while (used < buffer.length) {
      const { bytesRead } = await file.read(buffer, used, buffer.length - used, null);
      if (!bytesRead) break;
      used += bytesRead;
    }
    if (used > 2 * 1024 * 1024) throw Error('INPUT_LIMIT');
    content = buffer.subarray(0, used).toString('utf8');
  } finally {
    await file.close();
  }
  const data = JSON.parse(content);
  if (
    !data ||
    !Array.isArray(data.pages) ||
    Object.keys(data).some((k) => !['manifest', 'pages'].includes(k))
  )
    throw Error('INVALID_ENVELOPE');
  const { stagedEvents, ...summary } = previewSyntheticEvidence(data.manifest, data.pages);
  // Do not dump financial references or payloads to the terminal.
  delete summary.batchId;
  console.log(JSON.stringify(summary, null, 2));
  if (summary.status !== 'COMPLETE_SYNTHETIC') process.exitCode = 2;
}
main().catch(() => {
  console.error('PREVIEW_FAILED: invalid or oversized local JSON input.');
  process.exitCode = 1;
});
