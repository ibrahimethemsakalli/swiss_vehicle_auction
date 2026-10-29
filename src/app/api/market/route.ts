import { searchMarket, marketPageSize } from '../../../lib/market-search';
import { demoVehicles } from '../../../lib/demo';
import { filterInput } from '../../../lib/market-query';
import { filterVehicles } from '../../../lib/market-types';
import { publicValidation } from '../../../lib/validation-errors';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  let filters;
  try {
    filters = filterInput.parse(JSON.parse(params.get('filters') ?? '{}'));
  } catch (error) {
    return Response.json(
      { error: 'INVALID_FILTERS', validation: publicValidation(error) },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  const page = Math.max(1, Math.min(100000, Number(params.get('page')) || 1));
  if (!Number.isInteger(page)) return Response.json({ error: 'INVALID_PAGE' }, { status: 400 });
  const size = marketPageSize;
  if (!process.env.DATABASE_URL) {
    const all = demoVehicles(),
      matched = filterVehicles(all, filters);
    return Response.json({
      demo: true,
      vehicles: matched.slice((page - 1) * size, page * size),
      total: matched.length,
      page,
      catalog: all.map(({ make, model }) => ({ make, model })),
    });
  }
  try {
    const result = await searchMarket(filters, page);
    return Response.json({ demo: false, ...result }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ error: 'UNAVAILABLE' }, { status: 503 });
  }
}
