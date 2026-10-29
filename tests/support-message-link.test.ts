import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { supportMessageHref } from '../src/lib/support-message-link';
import { readSupportNavigation, supportNavigationHref } from '../src/lib/support-navigation';
import { supportRead } from '../src/lib/support';
const ticket = 'ac3d527c-024a-4385-8f79-65f33271133c',
  message = '980f2a87-48c0-467e-98cb-a2cdf07b332a';
test('four language links roundtrip without content or privilege-bearing tokens', () => {
  for (const admin of [true, false])
    for (const lang of ['de', 'fr', 'it', 'en']) {
      const href = supportMessageHref(ticket, message, admin, lang),
        url = new URL(href, 'http://local.invalid');
      assert.equal(url.pathname, admin ? '/admin/support' : '/support');
      assert.deepEqual([...url.searchParams.keys()], ['ticket', 'message', 'lang']);
      const nav = readSupportNavigation(url.searchParams, admin);
      assert.equal(nav.message, message);
      assert.equal(supportNavigationHref(nav, admin, lang), href);
    }
  assert.throws(() => supportMessageHref(ticket, 'javascript:bad', false, 'en'));
  for (const query of [
    `message=${message}`,
    `ticket=${ticket}&message=bad`,
    `ticket=${ticket}&message=${message}&message=${message}`,
  ])
    assert.equal(readSupportNavigation(new URLSearchParams(query), false).message, undefined);
});
test('direct-link access requires an eligible user and ticket ownership or admin role', async () => {
  const db: any = {
    user: { findUnique: async () => ({ id: 'buyer', role: 'PRIVATE_USER' }) },
    supportTicket: {
      findFirst: async (q: any) => {
        assert.equal(q.where.userId, 'buyer');
        return null;
      },
    },
  };
  await assert.rejects(supportRead(db, 'buyer', { id: ticket, context: message }), /NOT_FOUND/);
  await assert.rejects(
    supportRead(db, 'buyer', { id: ticket, context: message, admin: 'true' }),
    /FORBIDDEN/,
  );
  db.user.findUnique = async () => ({ id: 'admin', role: 'ADMIN', suspendedAt: new Date() });
  await assert.rejects(
    supportRead(db, 'admin', { id: ticket, context: message, admin: 'true' }),
    /FORBIDDEN/,
  );
});
test('authorized links still require the message to belong to the specified ticket', async () => {
  const db: any = {
    user: { findUnique: async () => ({ id: 'admin', role: 'ADMIN' }) },
    supportTicket: { findFirst: async () => ({ id: ticket }) },
    supportEntry: {
      findFirst: async (q: any) => {
        assert.deepEqual(q.where, { id: message, ticketId: ticket });
        return null;
      },
    },
  };
  await assert.rejects(
    supportRead(db, 'admin', { id: ticket, context: message, admin: 'true' }),
    /NOT_FOUND/,
  );
});
test('link and inaccessible-message text available in all languages', () => {
  for (const lang of ['de', 'fr', 'it', 'en']) {
    const o = JSON.parse(
      readFileSync(new URL('../src/messages/' + lang + '.json', import.meta.url), 'utf8'),
    );
    for (const key of ['mlLink', 'mlCreate', 'mlOpen', 'mlAccess', 'mlUnavailable', 'mlSelected'])
      assert.ok(o[key]?.length > 3);
  }
});
