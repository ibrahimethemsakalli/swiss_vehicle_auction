import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createDatabaseClient } from '../src/lib/database-client.ts';
import { mutateChat, readChat } from '../src/lib/messaging.ts';
import { messagingHandlers } from '../src/lib/messaging-http.ts';
import { ciEnvironment } from './ci-environment.mjs';
const source = new URL(process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || '');
assert.ok(['127.0.0.1', 'localhost'].includes(source.hostname));
const name = `autoveri_pm09_${randomUUID().replaceAll('-', '')}_test`;
const target = new URL(source);
target.pathname = `/${name}`;
const maintenance = new URL(source);
maintenance.pathname = '/postgres';
Object.assign(process.env, ciEnvironment(process.env, target.toString()));
const admin = createDatabaseClient(maintenance.toString()),
  db = createDatabaseClient(target.toString());
let created = false;
try {
  await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
  created = true;
  const migration = spawnSync(
    process.execPath,
    ['node_modules/prisma/build/index.js', 'migrate', 'deploy'],
    { env: process.env, encoding: 'utf8', timeout: 120000 },
  );
  assert.equal(migration.status, 0, migration.stderr);
  const users = await Promise.all(
    ['seller', 'buyer', 'outsider', 'moderator'].map((label, index) =>
      db.user.create({
        data: {
          email: `${label}@example.invalid`,
          phone: `pm09-${label}`,
          passwordHash: 'test-only',
          role: index === 3 ? 'ADMIN' : 'PRIVATE_USER',
          emailVerifiedAt: new Date(),
          phoneVerifiedAt: new Date(),
        },
      }),
    ),
  );
  const [seller, buyer, outsider, moderator] = users;
  // Narrow dependency check: admin moderation needs a valid OTP even on a non-UTC DB session.
  const { consumeChallenge, challengeHash } = await import('../src/lib/account-challenges.ts');
  await db.accountChallenge.create({
    data: {
      id: randomUUID(),
      userId: moderator.id,
      purpose: 'ADMIN',
      tokenHash: challengeHash('123456'),
      expiresAt: new Date(Date.now() + 300000),
    },
  });
  await db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL TIME ZONE 'Europe/Zurich'");
    await consumeChallenge(moderator.id, 'ADMIN', '123456', tx);
  });
  assert.equal(await db.accountChallenge.count({ where: { userId: moderator.id } }), 0);
  await db.accountChallenge.create({
    data: {
      id: randomUUID(),
      userId: moderator.id,
      purpose: 'ADMIN',
      tokenHash: challengeHash('123456'),
      expiresAt: new Date(Date.now() - 60000),
    },
  });
  await assert.rejects(
    () =>
      db.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL TIME ZONE 'Europe/Zurich'");
        await consumeChallenge(moderator.id, 'ADMIN', '123456', tx);
      }),
    /INVALID_CREDENTIALS/,
  );
  const { db: challengeClient } = await import('../src/lib/db.ts');
  await challengeClient.$disconnect();
  assert.equal((await readChat(db, moderator.id, {})).canModerate, true);
  assert.equal((await readChat(db, buyer.id, {})).canModerate, false);
  const vehicle = await db.vehicle.create({
    data: {
      userId: seller.id,
      stammnummer: 'test',
      vinChassis: randomUUID(),
      make: 'PM09',
      model: 'Isolated fixture',
      mileage: 1,
      canton: 'ZH',
      mfkDate: new Date(),
      serviceHistory: 'test',
      tireCondition: 'test',
      description: 'PM09 isolated fixture',
      images: [],
      listingType: 'AUCTION_7_DAYS',
      status: 'ACTIVE',
      startPrice: 100,
      auctionEndsAt: new Date(Date.now() + 86400000),
    },
  });
  const start = () => mutateChat(db, buyer.id, { action: 'start', vehicleId: vehicle.id });
  const [a, b] = await Promise.all([start(), start()]);
  assert.equal(a.id, b.id);
  const cid = a.id;
  const send = {
    action: 'send',
    conversationId: cid,
    requestId: randomUUID(),
    body: '<script>alert("text only")</script>',
  };
  const [m1, m2] = await Promise.all([
    mutateChat(db, buyer.id, send),
    mutateChat(db, buyer.id, send),
  ]);
  assert.equal(m1.id, m2.id);
  assert.equal(
    await db.notification.count({ where: { userId: seller.id, kind: 'CHAT_MESSAGE' } }),
    1,
  );
  await assert.rejects(
    () => mutateChat(db, buyer.id, { ...send, body: 'changed' }),
    /CHAT_CONFLICT/,
  );
  await assert.rejects(() => readChat(db, outsider.id, { conversationId: cid }), /FORBIDDEN/);
  await assert.rejects(() => readChat(db, moderator.id, { conversationId: cid }), /FORBIDDEN/);
  await assert.rejects(
    () => mutateChat(db, outsider.id, { ...send, requestId: randomUUID() }),
    /FORBIDDEN/,
  );
  let view = await readChat(db, seller.id, { conversationId: cid });
  assert.equal(view.messages[0].body, send.body);
  assert.equal(view.messages[0].own, false);
  assert.equal(JSON.stringify(view).includes(buyer.email), false);
  assert.equal(JSON.stringify(view).includes(buyer.phone), false);
  assert.equal(JSON.stringify(view).includes('senderId'), false);
  console.log(
    'PASS: isolated migration, private participants, idempotent creation/send, notification atomicity and DTO privacy',
  );

  const propose = {
    action: 'propose',
    conversationId: cid,
    requestId: randomUUID(),
    startsAt: new Date(Math.ceil((Date.now() + 86400000) / 1000) * 1000).toISOString(),
    location: 'Public station entrance',
  };
  const ap = await mutateChat(db, buyer.id, propose);
  assert.equal((await mutateChat(db, buyer.id, propose)).id, ap.id);
  assert.equal(
    (
      await mutateChat(db, buyer.id, {
        ...propose,
        startsAt: propose.startsAt.replace('.000Z', 'Z'),
      })
    ).id,
    ap.id,
    'Equivalent UTC precision remains idempotent',
  );
  await assert.rejects(
    () =>
      mutateChat(db, buyer.id, {
        action: 'appointment',
        conversationId: cid,
        id: ap.id,
        decision: 'ACCEPTED',
      }),
    /FORBIDDEN/,
  );
  await mutateChat(db, seller.id, {
    action: 'appointment',
    conversationId: cid,
    id: ap.id,
    decision: 'ACCEPTED',
  });
  await assert.rejects(
    () => mutateChat(db, seller.id, { ...propose, requestId: randomUUID() }),
    /CHAT_CONFLICT/,
  );
  await mutateChat(db, buyer.id, { action: 'block', conversationId: cid, blocked: true });
  for (const person of [buyer, seller])
    await assert.rejects(
      () => mutateChat(db, person.id, { ...send, requestId: randomUUID() }),
      /CHAT_BLOCKED/,
    );
  await mutateChat(db, seller.id, { action: 'block', conversationId: cid, blocked: false });
  assert.equal(
    (await readChat(db, seller.id, { conversationId: cid })).blocked,
    true,
    'Cannot remove peer block',
  );
  await mutateChat(db, seller.id, {
    action: 'appointment',
    conversationId: cid,
    id: ap.id,
    decision: 'CANCELLED',
  });
  assert.equal(
    (await db.appointment.findUniqueOrThrow({ where: { id: ap.id } })).status,
    'CANCELLED',
  );
  await mutateChat(db, buyer.id, { action: 'block', conversationId: cid, blocked: false });
  const pending = await mutateChat(db, buyer.id, { ...propose, requestId: randomUUID() });
  await mutateChat(db, seller.id, { action: 'block', conversationId: cid, blocked: true });
  assert.equal(
    (await db.appointment.findUniqueOrThrow({ where: { id: pending.id } })).status,
    'CANCELLED',
  );
  await assert.rejects(
    () =>
      mutateChat(db, seller.id, {
        action: 'appointment',
        conversationId: cid,
        id: pending.id,
        decision: 'ACCEPTED',
      }),
    /CHAT_BLOCKED/,
  );
  await mutateChat(db, seller.id, { action: 'block', conversationId: cid, blocked: false });
  await assert.rejects(
    () =>
      mutateChat(db, buyer.id, {
        ...propose,
        requestId: randomUUID(),
        startsAt: new Date(Date.now() - 60000).toISOString(),
      }),
    /CHAT_DATE/,
  );
  const declined = await mutateChat(db, buyer.id, { ...propose, requestId: randomUUID() });
  await mutateChat(db, seller.id, {
    action: 'appointment',
    conversationId: cid,
    id: declined.id,
    decision: 'DECLINED',
  });
  await assert.rejects(
    () =>
      mutateChat(db, seller.id, {
        action: 'appointment',
        conversationId: cid,
        id: declined.id,
        decision: 'ACCEPTED',
      }),
    /CHAT_CONFLICT/,
  );
  console.log(
    'PASS: appointment acceptance/decline/cancel, time bounds, self-accept rejection and bidirectional blocks',
  );

  const report = {
    action: 'report',
    conversationId: cid,
    messageId: m1.id,
    category: 'ABUSE',
    note: 'PM09 report fixture',
  };
  await mutateChat(db, seller.id, report);
  await mutateChat(db, seller.id, report);
  await assert.rejects(() => mutateChat(db, buyer.id, report), /FORBIDDEN/);
  await assert.rejects(() => readChat(db, buyer.id, { reports: 'true' }), /FORBIDDEN/);
  const reports = await readChat(db, moderator.id, { reports: 'true' });
  assert.equal(reports.reports.length, 1);
  await assert.rejects(
    () =>
      mutateChat(db, seller.id, {
        action: 'review',
        id: reports.reports[0].id,
        decision: 'HIDDEN',
      }),
    /FORBIDDEN/,
  );
  await mutateChat(db, moderator.id, {
    action: 'review',
    id: reports.reports[0].id,
    decision: 'HIDDEN',
  });
  assert.equal((await readChat(db, buyer.id, { conversationId: cid })).messages[0].body, null);
  assert.equal(
    (await db.messageReport.findUniqueOrThrow({ where: { id: reports.reports[0].id } })).reviewedBy,
    moderator.id,
  );
  assert.equal((await readChat(db, moderator.id, { reports: 'true' })).reports.length, 0);
  console.log(
    'PASS: reporting deduplication, admin-only review, retained audit and hidden-message redaction',
  );

  // Seed history directly: do not replay auction or payment flows.
  await db.chatMessage.createMany({
    data: Array.from({ length: 55 }, () => ({
      conversationId: cid,
      senderId: seller.id,
      requestId: randomUUID(),
      body: 'History fixture',
      createdAt: new Date('2026-01-01T00:00:00Z'),
    })),
  });
  const page1 = await readChat(db, buyer.id, { conversationId: cid }),
    page2 = await readChat(db, buyer.id, { conversationId: cid, before: page1.next });
  assert.equal(new Set([...page1.messages, ...page2.messages].map((m) => m.id)).size, 56);
  const second = await mutateChat(db, outsider.id, { action: 'start', vehicleId: vehicle.id });
  await assert.rejects(
    () => readChat(db, outsider.id, { conversationId: second.id, before: m1.id }),
    /FORBIDDEN/,
  );
  await db.$disconnect();
  assert.equal((await readChat(db, buyer.id, { conversationId: cid })).messages.length, 50);
  await db.user.update({ where: { id: buyer.id }, data: { suspendedAt: new Date() } });
  await assert.rejects(() => readChat(db, buyer.id, {}), /FORBIDDEN/);
  await assert.rejects(
    () => mutateChat(db, seller.id, { ...send, requestId: randomUUID() }),
    /FORBIDDEN/,
  );
  await db.user.update({
    where: { id: buyer.id },
    data: { suspendedAt: null, emailVerifiedAt: null },
  });
  await assert.rejects(
    () => mutateChat(db, buyer.id, { ...send, requestId: randomUUID() }),
    /VERIFICATION_REQUIRED/,
  );
  await db.user.update({ where: { id: buyer.id }, data: { emailVerifiedAt: new Date() } });
  await db.vehicle.update({ where: { id: vehicle.id }, data: { status: 'CANCELLED' } });
  const late = await db.user.create({
    data: {
      email: 'late@example.invalid',
      phone: 'pm09-late',
      passwordHash: 'test',
      emailVerifiedAt: new Date(),
      phoneVerifiedAt: new Date(),
    },
  });
  await assert.rejects(
    () => mutateChat(db, late.id, { action: 'start', vehicleId: vehicle.id }),
    /CHAT_UNAVAILABLE/,
  );
  // Sale parties may open a handover conversation on a closed listing, from direct synthetic rows.
  const hold = await db.paymentHold.create({
    data: {
      userId: late.id,
      vehicleId: vehicle.id,
      gateway: 'LOCAL_TEST',
      expiresAt: new Date(Date.now() + 86400000),
    },
  });
  const bid = await db.bid.create({
    data: {
      userId: late.id,
      vehicleId: vehicle.id,
      amount: 100,
      holdId: hold.id,
      requestId: randomUUID(),
      status: 'WON',
    },
  });
  await db.settlement.create({ data: { vehicleId: vehicle.id, bidId: bid.id } });
  const handover = await mutateChat(db, seller.id, { action: 'start', vehicleId: vehicle.id });
  assert.equal(
    (await mutateChat(db, late.id, { action: 'start', vehicleId: vehicle.id })).id,
    handover.id,
  );
  console.log(
    'PASS: stable history pagination, reconnect persistence, suspended/unverified guards and closed-listing sale-party access',
  );

  const http = messagingHandlers(db, async () => buyer.id),
    unauth = messagingHandlers(db, async () => {
      throw Error('UNAUTHORIZED');
    });
  const origin = process.env.NEXTAUTH_URL || 'http://localhost:3000';
  assert.equal((await unauth.GET(new Request(`${origin}/api/messages`))).status, 401);
  assert.equal(
    (await http.GET(new Request(`${origin}/api/messages?userId=${seller.id}`))).status,
    400,
  );
  const post = (value, requestOrigin = origin) =>
    http.POST(
      new Request(`${origin}/api/messages`, {
        method: 'POST',
        headers: { origin: requestOrigin, 'Content-Type': 'application/json' },
        body: JSON.stringify(value),
      }),
    );
  assert.equal((await post(send, 'https://other.invalid')).status, 403);
  assert.equal((await post({ ...send, senderId: seller.id })).status, 400);
  assert.equal((await post({ ...send, body: 'x'.repeat(13000) })).status, 400);
  const get = await http.GET(new Request(`${origin}/api/messages?conversationId=${cid}`));
  assert.equal(get.status, 200);
  assert.match(get.headers.get('cache-control'), /private.*no-store/);
  const bucket = Math.floor(Date.now() / 60000);
  await db.rateLimit.upsert({
    where: { key: `chat:${buyer.id}:${bucket}` },
    create: {
      key: `chat:${buyer.id}:${bucket}`,
      count: 20,
      expiresAt: new Date(Date.now() + 60000),
    },
    update: { count: 20 },
  });
  assert.equal((await post({ ...send, requestId: randomUUID() })).status, 429);
  assert.equal(await db.transaction.count(), 0, 'No payment transaction created by messaging');
  console.log(
    'PASS: HTTP authentication, origin, input/body limits, cache privacy and rate limits; no provider calls',
  );
} finally {
  await db.$disconnect();
  if (created) {
    assert.match(name, /^autoveri_pm09_[a-f0-9]{32}_test$/);
    await admin.$executeRawUnsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
  }
  await admin.$disconnect();
}
console.log('PASS: isolated PM09 database removed');
