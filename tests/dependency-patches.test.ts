import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { getToken } from 'next-auth/jwt';
import postcss from 'postcss';

test('patched NextAuth treats malformed Bearer encoding as an invalid token', async () => {
  for (const token of ['%E0%A4%A', '%ZZ', '%']) {
    const result = await getToken({
      req: { headers: { authorization: `Bearer ${token}` }, cookies: {} } as never,
      secret: 'ci-test-only-secret',
    });
    assert.equal(result, null);
  }
});
test('patched PostCSS refuses absolute sourcemap autoload without a trusted CSS filename', async () => {
  const root = resolve('.local/ci-patch-tests');
  await mkdir(root, { recursive: true });
  const folder = await mkdtemp(join(root, 'map-'));
  try {
    const map = join(folder, 'fixture.map');
    await writeFile(
      map,
      JSON.stringify({
        version: 3,
        file: 'fixture.css',
        sources: ['fixture-original.css'],
        sourcesContent: ['DO_NOT_AUTOLOAD_FIXTURE'],
        names: [],
        mappings: 'AAAA',
      }),
    );
    const css = `a { color: red } /*# sourceMappingURL=${map.replaceAll('\\', '/')} */`;
    const parsed = postcss.parse(css);
    assert.equal(parsed.source!.input.map, undefined);
    assert.equal(postcss.parse('a { color: red }').first!.type, 'rule');
  } finally {
    const relative = folder.slice(root.length);
    assert.ok(relative.startsWith('/') || relative.startsWith('\\'));
    await rm(folder, { recursive: true, force: true });
  }
});
