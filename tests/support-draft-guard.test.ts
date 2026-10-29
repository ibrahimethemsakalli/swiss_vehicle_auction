import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import {
  hasSupportDraft,
  installSupportDraftGuard,
  SUPPORT_LEAVE_EVENT,
} from '../src/lib/support-draft-guard';

function fixture() {
  const target = new EventTarget() as EventTarget & Record<string, any>;
  target.document = new EventTarget();
  target.navigation = new EventTarget();
  target.navigation.traverseTo = () => {};
  target.location = new URL('https://local.invalid/admin/support?ticket=1');
  let dirty = true,
    prompts = 0;
  let proceed: (() => void) | undefined;
  const guard = installSupportDraftGuard(
    target as unknown as Window,
    () => dirty,
    (action) => {
      prompts++;
      proceed = action;
    },
  );
  return {
    target,
    guard,
    setDirty: (v: boolean) => (dirty = v),
    accept: () => proceed?.(),
    prompts: () => prompts,
  };
}
test('either independent draft, including incomplete input, requires protection', () => {
  assert.equal(hasSupportDraft('', '', ''), false);
  for (const values of [
    ['subject', '', ''],
    ['', 'reply', ''],
    ['', '', 'reason'],
    ['', ' ', ''],
  ])
    assert.equal(hasSupportDraft(...(values as [string, string, string])), true);
  assert.equal(hasSupportDraft('', '', 'remaining assignment'), true);
});
test('cancel/accept, saved inputs and listener cleanup', () => {
  const f = fixture();
  assert.equal(
    f.guard.allow(() => {}),
    false,
  );
  assert.equal(
    f.target.dispatchEvent(
      new CustomEvent(SUPPORT_LEAVE_EVENT, { cancelable: true, detail: () => {} }),
    ),
    false,
  );
  f.accept();
  assert.equal(
    f.guard.allow(() => {}),
    true,
  );
  f.setDirty(false);
  const before = f.prompts();
  assert.equal(
    f.guard.allow(() => {}),
    true,
  );
  assert.equal(f.prompts(), before);
  f.setDirty(true);
  f.target.document.dispatchEvent(new Event('input'));
  assert.equal(
    f.guard.allow(() => {}),
    false,
  );
  f.guard.dispose();
  assert.equal(f.target.dispatchEvent(new Event(SUPPORT_LEAVE_EVENT, { cancelable: true })), true);
});
test('reload and cancellable same-document back/forward protect drafts', () => {
  const f = fixture();
  assert.equal(f.target.dispatchEvent(new Event('beforeunload', { cancelable: true })), false);
  const back = () =>
    Object.assign(new Event('navigate', { cancelable: true }), {
      navigationType: 'traverse',
      destination: { sameDocument: true, key: 'prior' },
    });
  assert.equal(f.target.navigation.dispatchEvent(back()), false);
  f.accept();
  assert.equal(f.target.navigation.dispatchEvent(back()), true);
  f.setDirty(false);
  assert.equal(f.target.dispatchEvent(new Event('beforeunload', { cancelable: true })), true);
  f.guard.dispose();
});
test('all four locales provide distinct, nonempty departure warnings', () => {
  const messages = ['de', 'fr', 'it', 'en'].map(
    (lang) =>
      JSON.parse(
        readFileSync(new URL('../src/messages/' + lang + '.json', import.meta.url), 'utf8'),
      ).spUnsavedLeave,
  );
  assert.equal(new Set(messages).size, 4);
  for (const message of messages) assert.ok(message.length > 50);
});

test('links cancel before navigation, while new tabs, downloads and same-page anchors stay usable', () => {
  const f = fixture();
  let clicks = 0;
  const anchor = {
    href: 'https://local.invalid/dashboard',
    target: '',
    hasAttribute: () => false,
    click: () => clicks++,
  };
  const click = (extra = {}) => {
    const e = Object.assign(new Event('click', { cancelable: true }), { button: 0, ...extra });
    Object.defineProperty(e, 'target', { value: { closest: () => anchor } });
    return f.target.document.dispatchEvent(e);
  };
  assert.equal(click({ ctrlKey: true }), true);
  anchor.target = '_blank';
  assert.equal(click(), true);
  anchor.target = '';
  anchor.hasAttribute = () => true;
  assert.equal(click(), true);
  anchor.hasAttribute = () => false;
  anchor.href = 'https://local.invalid/admin/support?ticket=1#main';
  assert.equal(click(), true);
  anchor.href = 'https://local.invalid/dashboard';
  assert.equal(click(), false);
  assert.equal(clicks, 0);
  f.accept();
  assert.equal(clicks, 1);
  f.guard.dispose();
});
