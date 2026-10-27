import { z } from 'zod';
import { legalLocales, LegalError } from '../../../../lib/legal-policy';
import { publicLegal } from '../../../../lib/legal';
import { publicValidation } from '../../../../lib/validation-errors';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try {
    const params = Object.fromEntries(new URL(request.url).searchParams);
    const input = z
      .object({
        kind: z.enum(['TERMS', 'PRIVACY']),
        lang: z.enum(legalLocales),
        version: z.string().min(1).max(64).optional(),
      })
      .strict()
      .parse(params);
    return Response.json(await publicLegal(input.kind, input.lang, input.version), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof LegalError ? error.code : 'LEGAL_UNAVAILABLE',
        ...(error instanceof z.ZodError ? { validation: publicValidation(error) } : {}),
      },
      {
        status:
          error instanceof LegalError ? error.status : error instanceof z.ZodError ? 400 : 503,
      },
    );
  }
}
