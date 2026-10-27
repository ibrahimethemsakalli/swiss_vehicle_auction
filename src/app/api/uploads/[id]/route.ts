import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { uploadDirectory } from '../../../../lib/uploads';
import { photoAccess } from '../../../../lib/media';
import { mediaFilenamePattern } from '../../../../lib/photo-processing';
import { requireUser } from '../../../../lib/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!mediaFilenamePattern.test(id))
    return new Response(null, { status: 404, headers: { 'Cache-Control': 'private,no-store' } });
  try {
    let access = await photoAccess(id);
    if (!access) {
      let viewer: string | undefined;
      try {
        viewer = await requireUser();
      } catch {}
      if (viewer) access = await photoAccess(id, viewer);
    }
    if (!access)
      return new Response(null, { status: 404, headers: { 'Cache-Control': 'private,no-store' } });
    const bytes = await readFile(path.join(uploadDirectory(), id));
    return new Response(bytes, {
      headers: {
        'Content-Type': id.endsWith('.png') ? 'image/png' : 'image/jpeg',
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control':
          access === 'public' ? 'public,max-age=0,must-revalidate' : 'private,no-store',
        Vary: 'Cookie',
      },
    });
  } catch {
    return new Response(null, { status: 404, headers: { 'Cache-Control': 'private,no-store' } });
  }
}
