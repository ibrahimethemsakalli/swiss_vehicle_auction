import galleries from '../data/sample-photos.json';
export function samplePhotoPaths(index: number): string[] {
  const gallery = galleries.find((item) => item.index === index);
  if (!gallery) throw new Error('Unknown sample photo gallery');
  return gallery.photos.map((photo) => photo.src);
}
