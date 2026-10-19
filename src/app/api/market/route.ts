import { db } from '../../../lib/db';
import { demoVehicles } from '../../../lib/demo';
import { publicVehicle, publicVehicleInclude } from '../../../lib/public-vehicle';
import { filterInput, marketWhere } from '../../../lib/market-query';
import { filterVehicles } from '../../../lib/market-types';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  let filters;
  try {
    filters = filterInput.parse(JSON.parse(params.get('filters') ?? '{}'));
  } catch {
    return Response.json({ error: 'INVALID_FILTERS' }, { status: 400 });
  }
  const page = Math.max(1, Math.min(100000, Number(params.get('page')) || 1));
  if (!Number.isInteger(page)) return Response.json({ error: 'INVALID_PAGE' }, { status: 400 });
  const size = 24;
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
    const [rows, catalog] = await Promise.all([
      db.vehicle.findMany({
        where: marketWhere(filters),
        select: {
          id: true,
          listingType: true,
          startPrice: true,
          currentPrice: true,
          buyNowPrice: true,
          auctionEndsAt: true,
        },
      }),
      db.vehicle.groupBy({
        by: ['make', 'model'],
        where: { status: 'ACTIVE' },
        orderBy: [{ make: 'asc' }, { model: 'asc' }],
      }),
    ]);
    const price = (v: (typeof rows)[number]) =>
      Number(
        v.listingType === 'FIXED_PRICE_OFFERS'
          ? (v.buyNowPrice ?? v.startPrice)
          : (v.currentPrice ?? v.startPrice),
      );
    rows.sort(
      (a, b) =>
        (filters.sort === 'priceAsc'
          ? price(a) - price(b)
          : filters.sort === 'priceDesc'
            ? price(b) - price(a)
            : (a.auctionEndsAt?.getTime() ?? Infinity) -
              (b.auctionEndsAt?.getTime() ?? Infinity)) || a.id.localeCompare(b.id),
    );
    const ids = rows.slice((page - 1) * size, page * size).map((v) => v.id);
    const vehicles = await db.vehicle.findMany({
      where: { id: { in: ids }, status: 'ACTIVE' },
      include: publicVehicleInclude,
    });
    const byId = new Map(vehicles.map((v) => [v.id, v]));
    return Response.json(
      {
        demo: false,
        vehicles: ids.flatMap((id) => (byId.has(id) ? [publicVehicle(byId.get(id)!)] : [])),
        total: rows.length,
        page,
        catalog,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch {
    return Response.json({ error: 'UNAVAILABLE' }, { status: 503 });
  }
}
