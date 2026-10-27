import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { resolve, relative, sep } from 'node:path';
import { readFile, readdir, rm } from 'node:fs/promises';
import { io } from 'socket.io-client';
import { ciEnvironment } from './ci-environment.mjs';
import { demoVehicles } from '../src/lib/demo';

async function port() {
  const probe = createServer();
  await new Promise<void>((done) => probe.listen(0, '127.0.0.1', done));
  const number = (probe.address() as { port: number }).port;
  await new Promise<void>((done, reject) =>
    probe.close((error) => (error ? reject(error) : done())),
  );
  return number;
}
async function main() {
  const serverPort = await port(),
    origin = `http://127.0.0.1:${serverPort}`;
  const folder = resolve(`.local/framework-http-${randomUUID()}`);
  const env: NodeJS.ProcessEnv = {
    ...ciEnvironment(),
    NODE_ENV: 'production',
    CI_BUILD: 'true',
    HOST: '127.0.0.1',
    PORT: String(serverPort),
    NEXTAUTH_URL: origin,
    OPERATIONS_DIR: folder,
  };
  let child: ChildProcess | undefined;
  try {
    child = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], {
      env,
      stdio: 'pipe',
      windowsHide: true,
    });
    child.stdout?.resume();
    child.stderr?.resume();
    child.on('error', () => {});
    const deadline = Date.now() + 45000;
    let ready = false;
    while (Date.now() < deadline && child.exitCode === null) {
      try {
        ready = (await fetch(`${origin}/api/health/live`, { signal: AbortSignal.timeout(1500) }))
          .ok;
        if (ready) break;
      } catch {}
      await new Promise((done) => setTimeout(done, 150));
    }
    assert.ok(ready, 'Upgraded production custom server must start');
    if (!process.argv.includes('--auth-socket-only')) {
      const id = demoVehicles()[0].id;
      const market = await fetch(`${origin}/api/market/${id}`);
      assert.equal(market.status, 200);
      assert.equal((await market.json()).vehicle.id, id);
      assert.equal((await fetch(`${origin}/vehicles/${id}`)).status, 200);
      const photo = await fetch(`${origin}/api/uploads/invalid`);
      assert.equal(photo.status, 404);
      assert.match(photo.headers.get('cache-control')!, /private.*no-store/);
      for (const kind of ['privacy', 'terms']) {
        const page = await fetch(`${origin}/${kind}?version=FRAMEWORK_QUERY_FIXTURE&lang=fr`);
        assert.equal(page.status, 200);
        assert.ok((await page.text()).includes('FRAMEWORK_QUERY_FIXTURE'));
      }
      console.log(
        'PASS: Next16 production custom host, promised route/query params, public detail SSR and private missing-file response.',
      );
    }
    const csrf = await fetch(`${origin}/api/auth/csrf`);
    assert.equal(csrf.status, 200);
    assert.ok((await csrf.json()).csrfToken);
    assert.ok(csrf.headers.getSetCookie().some((v) => v.includes('next-auth.csrf-token')));
    const session = await fetch(`${origin}/api/auth/session`);
    assert.equal(session.status, 200);
    assert.deepEqual(await session.json(), {});
    const sell = await fetch(`${origin}/sell`, { redirect: 'manual' });
    assert.equal(sell.status, 307);
    assert.equal(sell.headers.get('location'), '/login?next=/sell');
    const protectedApi = await fetch(`${origin}/api/security`, {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'generate', currentPassword: 'unauthenticated-fixture' }),
    });
    assert.equal(protectedApi.status, 401);
    console.log(
      'PASS: NextAuth async cookie/header context, CSRF cookie, empty session and unauthenticated page/API guards.',
    );
    for (const transport of ['polling', 'websocket'] as const) {
      const socket = io(origin, {
        autoConnect: false,
        reconnection: false,
        transports: [transport],
        extraHeaders: { Origin: origin },
        timeout: 5000,
      });
      try {
        await new Promise<void>((done, reject) => {
          socket.once('connect', () => done());
          socket.once('connect_error', reject);
          socket.connect();
        });
        assert.equal(socket.io.engine.transport.name, transport);
      } finally {
        socket.disconnect();
      }
    }
    assert.equal((await fetch(`${origin}/api/health/ready`)).status, 503);
    const files = (await readdir(folder)).filter((n) => n.endsWith('.json'));
    assert.equal(files.length, 1);
    const state = JSON.parse(await readFile(resolve(folder, files[0]), 'utf8'));
    assert.ok(
      state.workers.every(
        (w: { state: string; lastStartedAt: string | null }) =>
          w.state === 'disabled' && w.lastStartedAt === null,
      ),
    );
    console.log(
      'PASS: Socket.IO polling and WebSocket handshake coexist with Next16; DB and all business workers disabled.',
    );
  } finally {
    if (child && child.exitCode === null) {
      child.kill('SIGTERM');
      await Promise.race([
        new Promise<void>((done) => child!.once('exit', () => done())),
        new Promise<void>((done) => setTimeout(done, 5000)),
      ]);
      if (child.exitCode === null) child.kill('SIGKILL');
    }
    const relativePath = relative(resolve('.local'), folder);
    assert.ok(
      relativePath && !relativePath.startsWith(`..${sep}`) && !relativePath.startsWith(sep),
    );
    await rm(folder, { recursive: true, force: true });
  }
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'FRAMEWORK_HTTP_TEST_FAILED');
  process.exitCode = 1;
});
