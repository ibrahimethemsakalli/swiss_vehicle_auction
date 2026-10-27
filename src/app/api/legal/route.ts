import { legalSummary } from '../../../lib/legal';
import { z } from 'zod';
import { legalLocales } from '../../../lib/legal-policy';
import { publicValidation } from '../../../lib/validation-errors';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try {
    const lang = z.enum(legalLocales).parse(new URL(request.url).searchParams.get('lang') ?? 'de');
    return Response.json(await legalSummary(lang), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json(
      {
        error: 'LEGAL_UNAVAILABLE',
        ...(error instanceof z.ZodError ? { validation: publicValidation(error) } : {}),
      },
      { status: error instanceof z.ZodError ? 400 : 503 },
    );
  }
}
