import { samplePhotoPaths } from '../src/lib/sample-photos';
import { sampleFacts } from '../src/lib/sample-facts';
export async function sampleGallery(index: number, _title: string, _color: string) {
  return samplePhotoPaths(index);
}
export function sampleSpecs(index: number, _make: string, _shape: string) {
  return sampleFacts(index + 1);
}
