'use client';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useLocale, type MessageKey } from './providers';
import { Button } from './ui/button';
import { RetentionReviewCard, type ReviewRow } from './retention-review-card';
type Row = ReviewRow & {
  id: string;
  conversationId: string;
  reason: string;
  createdAt: string;
  createdById: string;
  reviewedAt: string | null;
  reviewNote: string | null;
  reviewedById: string | null;
};
export function RetentionProtections({ onChange }: { onChange: () => void }) {
  const target = useSearchParams().get('request');
  return <ProtectionList key={target ?? 'all'} target={target} onChange={onChange} />;
}
function ProtectionList({ onChange, target }: { onChange: () => void; target: string | null }) {
  const { t } = useLocale();
  const [rows, setRows] = useState<Row[]>([]),
    [next, setNext] = useState<string | null>(null);
  const [state, setState] = useState('active'),
    [busy, setBusy] = useState(false),
    [loaded, setLoaded] = useState(false);
  const [message, setMessage] = useState<MessageKey | null>(null);
  const [conversation, setConversation] = useState(''),
    [reason, setReason] = useState('');
  const [viewerId, setViewerId] = useState('');
  const lock = useRef(false);
  async function load(after?: string) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setMessage(null);
    setLoaded(false);
    setRows([]);
    setNext(null);
    try {
      const r = await fetch(
        `/api/admin/retention/protections?${target ? 'request=' + encodeURIComponent(target) : 'state=' + state}${after ? '&after=' + encodeURIComponent(after) : ''}`,
        { cache: 'no-store' },
      );
      if (!r.ok) throw Error();
      const data = await r.json();
      setRows(data.rows);
      setViewerId(data.viewerId);
      setNext(data.next);
      setLoaded(true);
    } catch {
      setMessage('rpError');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  useEffect(() => {
    setRows([]);
    setNext(null);
    setLoaded(false);
    if (target) void load();
  }, [target]);
  async function submit(command: unknown) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setMessage(null);
    try {
      const r = await fetch('/api/admin/retention/protections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(command),
      });
      if (!r.ok) {
        const data = await r.json();
        const keys: Record<string, MessageKey> = {
          AUTOMATIC_PROTECTION: 'pgAuto',
          UNCERTAIN: 'pgUncertain',
          INCOMPLETE: 'pgUncertain',
          INVALID_EVIDENCE: 'pgEvidenceError',
          SECOND_ADMIN_REQUIRED: 'pgSecond',
          PARTICIPANT: 'pgParticipant',
          STALE_REVIEW: 'pgStale',
          LEGACY_REVIEW_DISABLED: 'pgLegacyDisabled',
          FORBIDDEN: 'pgForbidden',
          INVALID_BODY: 'pgValidation',
        };
        setMessage(
          keys[data.error] ??
            (r.status === 409 ? 'rpConflict' : r.status === 404 ? 'rpMissing' : 'rpError'),
        );
        return;
      }
      setRows([]);
      setNext(null);
      setLoaded(false);
      setConversation('');
      setReason('');

      setMessage('pgSaved');
      onChange();
      window.dispatchEvent(new Event('notifications-changed'));
    } catch {
      setMessage('rpError');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const validNote = (s: string) => s.trim().length >= 10 && s.trim().length <= 1000;
  return (
    <section className="border rounded-lg p-3 my-5 min-w-0 break-words" aria-label={t('rpTitle')}>
      <h2 className="text-xl font-bold">{t('rpTitle')}</h2>
      <p className="my-3">{t('pgNotice')}</p>
      {target && (
        <p className="my-3">
          {t('rhTarget')} <Link href="/admin/retention">{t('rhAll')}</Link>
        </p>
      )}
      {!target && (
        <form
          noValidate
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (
              !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
                conversation.trim(),
              ) ||
              !validNote(reason)
            ) {
              setMessage('rpValidation');
              return;
            }
            void submit({ action: 'create', conversationId: conversation.trim(), reason });
          }}
        >
          <label className="grid gap-1">
            {t('rpConversation')}
            <input
              className="border rounded p-2 w-full min-w-0"
              value={conversation}
              maxLength={36}
              disabled={busy}
              onChange={(e) => setConversation(e.target.value)}
            />
          </label>
          <label className="grid gap-1">
            {t('rpReason')}
            <textarea
              className="border rounded p-2 w-full min-w-0"
              rows={3}
              value={reason}
              maxLength={1000}
              disabled={busy}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <Button disabled={busy} type="submit" className="whitespace-normal h-auto">
            {t('rpCreate')}
          </Button>
        </form>
      )}
      <div className="grid gap-3 my-4 sm:grid-cols-2">
        {!target && (
          <label className="grid gap-1">
            {t('rpQueue')}
            <select
              className="border rounded p-2 w-full min-w-0"
              disabled={busy}
              value={state}
              onChange={(e) => {
                setState(e.target.value);
                setRows([]);
                setLoaded(false);
                setNext(null);
                setMessage(null);
              }}
            >
              <option value="active">{t('pgActive')}</option>
              <option value="released">{t('pgReleased')}</option>
            </select>
          </label>
        )}
        <Button disabled={busy} onClick={() => void load()} className="whitespace-normal h-auto">
          {t('chatRefresh')}
        </Button>
      </div>
      {busy && <p role="status">{t('loading')}</p>}
      {message && <p role={message === 'pgSaved' ? 'status' : 'alert'}>{t(message)}</p>}
      {loaded && !rows.length && <p>{t('rpEmpty')}</p>}
      <ul className="space-y-4">
        {rows.map((row) => (
          <li key={row.id} className="border rounded p-3 min-w-0">
            <p className="break-all">
              {t('rpConversation')}: {row.conversationId}
            </p>
            <p className="whitespace-pre-wrap">
              {t('rpReason')}: {row.reason}
            </p>
            <p>
              {t('rpCreated')}: {row.createdAt}
            </p>
            <p className="break-all">
              {t('rpActor')}: {row.createdById}
            </p>
            <RetentionReviewCard row={row} viewerId={viewerId} busy={busy} submit={submit} />
          </li>
        ))}
      </ul>
      {next && (
        <Button disabled={busy} onClick={() => void load(next)}>
          {t('rpNext')}
        </Button>
      )}
    </section>
  );
}
