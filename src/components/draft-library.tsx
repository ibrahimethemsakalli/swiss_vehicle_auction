'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useLocale, type MessageKey } from './providers';
import { Button } from './ui/button';
type Row = {
  id: string;
  revision: number;
  vehicleId: string | null;
  updatedAt: string;
  step: number;
  payload: { draft: { make?: string; model?: string } };
};
type Recoverable = {
  id: string;
  make: string;
  model: string;
  status: string;
  version: number;
  _count: { bids: number; holds: number };
  settlement: unknown;
  revisions: {
    version: number;
    action: string;
    note: string;
    corrections: string[];
    createdAt: string;
  }[];
};
export function DraftLibrary() {
  const { t, date } = useLocale(),
    { status } = useSession();
  const [rows, setRows] = useState<Row[]>([]),
    [pending, setPending] = useState<
      { id: string; make: string; model: string; version: number }[]
    >([]),
    [error, setError] = useState(false),
    [busy, setBusy] = useState(false),
    [loaded, setLoaded] = useState(false);
  const [recoverable, setRecoverable] = useState<Recoverable[]>([]);
  async function load() {
    setError(false);
    try {
      const r = await fetch('/api/listing-drafts', { cache: 'no-store' });
      if (!r.ok) throw Error();
      const d = await r.json();
      setRows(d.drafts);
      setPending(d.pending);
      setRecoverable(d.recoverable ?? []);
      setLoaded(true);
    } catch {
      setError(true);
    }
  }
  useEffect(() => {
    if (status === 'authenticated') void load();
  }, [status]);
  async function action(payload: unknown) {
    setBusy(true);
    setError(false);
    try {
      const r = await fetch('/api/listing-drafts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!r.ok) throw Error();
      const d = await r.json();
      if (d.id) window.location.assign(`/sell?draft=${d.id}`);
      else await load();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="container drafts-page">
      <h1>{t('draftsTitle')}</h1>
      <p>{t('draftsHint')}</p>
      {status === 'loading' ? (
        <p role="status">{t('loading')}</p>
      ) : status !== 'authenticated' ? (
        <Link href="/login?next=/sell">{t('signInRequired')}</Link>
      ) : (
        <>
          <div className="draft-actions">
            <Button asChild>
              <Link href="/sell">{t('draftNew')}</Link>
            </Button>
            <Button variant="outline" disabled={busy} onClick={() => void load()}>
              {t('chatRefresh')}
            </Button>
          </div>
          {error && <p role="alert">{t('draftFailed')}</p>}
          {!loaded && !error && <p>{t('loading')}</p>}
          {loaded && !rows.length && <p>{t('draftEmpty')}</p>}
          {rows.map((row) => (
            <article className="panel draft-row" key={row.id}>
              <h2>
                {row.payload.draft.make || t('draftUntitled')} {row.payload.draft.model}
              </h2>
              <p>
                {t('draftSavedAt')} {date(row.updatedAt)} · {t('draftStep', { step: row.step + 1 })}
              </p>
              <div className="draft-actions">
                <Button asChild>
                  <Link href={`/sell?draft=${row.id}`}>{t('draftResume')}</Link>
                </Button>
                {!row.vehicleId && (
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      void action({ action: 'discard', id: row.id, revision: row.revision })
                    }
                  >
                    {t('draftDiscard')}
                  </Button>
                )}
              </div>
            </article>
          ))}
          <h2>{t('revisionTitle')}</h2>
          <p>{t('relistHint')}</p>
          {recoverable
            .filter((v) => v.revisions.length || ['EXPIRED', 'REJECTED'].includes(v.status))
            .map((v) => (
              <article key={v.id} className="panel draft-row">
                <h3>
                  {v.make} {v.model}
                </h3>
                <p>{t(v.status as MessageKey)}</p>
                {v.revisions.map((r, i) => (
                  <details
                    key={`${r.version}-${r.action}`}
                    open={i === 0 || r.action === 'REJECTED'}
                  >
                    <summary>
                      {t('revisionVersion')} {r.version} · {t(`revision${r.action}` as MessageKey)}{' '}
                      · {date(r.createdAt)}
                    </summary>
                    <p className="description-text">{r.note}</p>
                    <ul>
                      {r.corrections.map((c) => (
                        <li key={c}>{t(`correction${c}` as MessageKey)}</li>
                      ))}
                    </ul>
                  </details>
                ))}
                {['REJECTED', 'EXPIRED'].includes(v.status) &&
                  (v._count.bids || v._count.holds || v.settlement ? (
                    <p>{t('relistLocked')}</p>
                  ) : (
                    <Button
                      disabled={busy}
                      onClick={() =>
                        void action({
                          action: v.status === 'REJECTED' ? 'revise' : 'relist',
                          vehicleId: v.id,
                          version: v.version,
                        })
                      }
                    >
                      {t(v.status === 'REJECTED' ? 'revisionEdit' : 'relistStart')}
                    </Button>
                  ))}
              </article>
            ))}
          <h2>{t('draftPending')}</h2>
          <p>{t('draftEditWarning')}</p>
          {pending.map((v) => (
            <article key={v.id} className="panel draft-row">
              <h3>
                {v.make} {v.model}
              </h3>
              <Button
                disabled={busy}
                onClick={() => void action({ action: 'edit', vehicleId: v.id, version: v.version })}
              >
                {t('draftEdit')}
              </Button>
            </article>
          ))}
        </>
      )}
    </section>
  );
}
