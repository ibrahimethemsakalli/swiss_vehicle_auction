import { readiness } from '../../../../lib/operations';
export const dynamic = 'force-dynamic';
export async function GET() {
  let ready = false;
  try {
    ready = await readiness();
  } catch {}
  return Response.json(
    { status: ready ? 'ready' : 'not_ready' },
    { status: ready ? 200 : 503, headers: { 'Cache-Control': 'no-store' } },
  );
}
