import 'dotenv/config';
import { db } from '../src/lib/db';
import { sampleGallery, sampleSpecs } from './sample-gallery';
async function main() {
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (
    process.env.NODE_ENV === 'production' ||
    !['localhost', '127.0.0.1'].includes(url.hostname) ||
    url.pathname !== '/autoveri'
  )
    throw Error('Local development database required');
  const samples = await db.vehicle.findMany({
    where: { isSample: true, id: { startsWith: '91000000-0000-4000-8000-' } },
  });
  const shapes = [
    'hatch',
    'estate',
    'sedan',
    'suv',
    'estate',
    'hatch',
    'suv',
    'hatch',
    'sport',
    'sedan',
    'hatch',
    'estate',
  ];
  for (const v of samples) {
    const index = Number(v.id.slice(-12));
    if (index < 1 || index > 12) continue;
    const images = await sampleGallery(
      index,
      `${v.make} ${v.model}`,
      [
        '#2563eb',
        '#64748b',
        '#d4d4d8',
        '#0f766e',
        '#a1a1aa',
        '#dc2626',
        '#475569',
        '#f59e0b',
        '#e2e8f0',
        '#1e293b',
        '#84cc16',
        '#14532d',
      ][index - 1],
    );
    // Only media/specifications change. No auction dates, prices, users or settlement records touched.
    await db.vehicle.update({
      where: { id: v.id },
      data: { images, ...sampleSpecs(index - 1, v.make, shapes[index - 1]) },
    });
  }
  console.log(
    `Updated ${samples.length} sample galleries and technical specifications; financial state preserved.`,
  );
}
main().finally(() => db.$disconnect());
