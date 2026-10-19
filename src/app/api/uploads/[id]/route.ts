import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { uploadDirectory } from '../../../../lib/uploads';
export const runtime = 'nodejs';
export async function GET(_: Request, { params }: { params: { id: string } }) {
  if (!/^[0-9a-f-]{36}\.(jpg|png)$/.test(params.id)) return new Response(null, { status: 404 });
  try {
    const bytes = await readFile(path.join(uploadDirectory(), params.id));
    return new Response(bytes, {
      headers: {
        'Content-Type': params.id.endsWith('.png') ? 'image/png' : 'image/jpeg',
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'public,max-age=86400',
      },
    });
  } catch {
    return new Response(null, { status: 404 });
  }
}
