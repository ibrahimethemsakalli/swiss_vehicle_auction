'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { trustCommand, reportCategories } from '../lib/trust-rules';
import { useLocale, type MessageKey } from './providers';
import { Button } from './ui/button';
import { Select, Textarea } from './ui/form-controls';
import { useResource } from './common';
const errorKey = (code: string): MessageKey =>
  (
    ({
      FORBIDDEN: 'trustForbidden',
      UNAUTHORIZED: 'trustLogin',
      VERIFICATION_REQUIRED: 'trustVerify',
      TRUST_DUPLICATE: 'trustDuplicate',
      TRUST_INELIGIBLE: 'trustIneligible',
      TRUST_CONFLICT: 'trustConflict',
      TRUST_SELF_REVIEW: 'trustSelfReview',
      RATE_LIMITED: 'trustRateLimit',
    }) as Record<string, MessageKey>
  )[code] ?? 'trustFailed';
const label = (value: string): MessageKey => `trust${value}` as MessageKey;
async function request(query: string, command?: unknown) {
  const response = await fetch(
    '/api/trust' + query,
    command
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(command),
        }
      : { cache: 'no-store' },
  );
  const body = await response.json();
  if (!response.ok) throw Error(body.error);
  return body;
}
function TrustForm({
  action,
  id,
  onDone,
}: {
  action: 'report' | 'rate' | 'reply' | 'appeal' | 'decideReport' | 'decideAppeal';
  id: string;
  onDone: () => void;
}) {
  const { t } = useLocale();
  const [note, setNote] = useState(''),
    [choice, setChoice] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<MessageKey | null>(null);
  const choices =
    action === 'report'
      ? [...reportCategories]
      : action === 'rate'
        ? ['1', '2', '3', '4', '5']
        : action === 'decideReport'
          ? ['DISMISSED', 'WARNING', 'ESCALATED']
          : action === 'decideAppeal'
            ? ['KEEP', 'HIDE']
            : [];
  return (
    <form
      className="trust-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy) return;
        const command = {
          action,
          note,
          ...(action === 'report'
            ? { vehicleId: id, category: choice }
            : action === 'rate'
              ? { settlementId: id, rating: Number(choice) }
              : action === 'reply' || action === 'appeal'
                ? { reviewId: id }
                : { id, decision: choice }),
        };
        if (!trustCommand.safeParse(command).success) {
          setError('trustInvalid');
          return;
        }
        setBusy(true);
        setError(null);
        try {
          await request('', command);
          setNote('');
          onDone();
        } catch (err) {
          setError(errorKey(err instanceof Error ? err.message : ''));
        } finally {
          setBusy(false);
        }
      }}
    >
      {!!choices.length && (
        <label>
          {t(
            action === 'report'
              ? 'trustCategory'
              : action === 'rate'
                ? 'trustRating'
                : 'trustDecision',
          )}
          <Select required value={choice} onChange={(e) => setChoice(e.target.value)}>
            <option value="">{t('trustChoose')}</option>
            {choices.map((c) => (
              <option key={c} value={c}>
                {action === 'rate' ? `${c}/5` : t(label(c))}
              </option>
            ))}
          </Select>
        </label>
      )}
      <label>
        {t(action === 'rate' ? 'trustComment' : action === 'reply' ? 'trustReply' : 'trustNote')}
        <Textarea
          required
          minLength={5}
          maxLength={1000}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </label>
      <p className="fine-print">{t('trustPrivacy')}</p>
      <Button disabled={busy}>{t('trustSubmit')}</Button>
      {error && <p role="alert">{t(error)}</p>}
    </form>
  );
}
export function ListingTrust({ vehicleId, isSample }: { vehicleId: string; isSample?: boolean }) {
  return isSample ? null : <ListingTrustContent vehicleId={vehicleId} />;
}
function ListingTrustContent({ vehicleId }: { vehicleId: string }) {
  const { t, number, date } = useLocale();
  const { status, data: session } = useSession();
  const [sent, setSent] = useState(false),
    [page, setPage] = useState(1);
  const reputation = useResource<{
    items: { rating: number; note: string; response: string | null; createdAt: string }[];
    total: number;
    average: number | null;
  }>(`/api/reputation/${encodeURIComponent(vehicleId)}?page=${page}`);
  useEffect(() => setSent(false), [vehicleId, session?.user?.email]);
  return (
    <section className="panel trust-panel">
      <h2>{t('trustSellerReviews')}</h2>
      <p>{t('trustVerifiedSale')}</p>
      {reputation.error ? (
        <p role="alert">
          {t('trustFailed')} <Button onClick={reputation.reload}>{t('retry')}</Button>
        </p>
      ) : reputation.loading ? (
        <p>{t('loading')}</p>
      ) : (
        <>
          <p>
            {reputation.data?.average == null
              ? t('trustNoReviews')
              : `${number(reputation.data.average)} / 5 · ${reputation.data.total} ${t('trustReviews')}`}
          </p>
          {reputation.data?.items.map((r, i) => (
            <article key={`${r.createdAt}:${i}`} className="trust-item">
              <strong>
                {r.rating}/5 · {date(r.createdAt)}
              </strong>
              <p className="trust-text">{r.note}</p>
              {r.response && (
                <blockquote>
                  {t('trustReply')}: {r.response}
                </blockquote>
              )}
            </article>
          ))}
          {!!reputation.data && reputation.data.total > 20 && (
            <div className="trust-actions">
              <Button disabled={page === 1} onClick={() => setPage(page - 1)}>
                {t('trustPrevious')}
              </Button>
              <span>{page}</span>
              <Button
                disabled={page * 20 >= reputation.data.total}
                onClick={() => setPage(page + 1)}
              >
                {t('trustNext')}
              </Button>
            </div>
          )}
        </>
      )}
      <details>
        <summary>{t('trustReportListing')}</summary>
        {status !== 'authenticated' ? (
          <Link href="/login">{t('trustLogin')}</Link>
        ) : sent ? (
          <p role="status">{t('trustReportSent')}</p>
        ) : (
          <TrustForm
            key={session?.user?.email}
            action="report"
            id={vehicleId}
            onDone={() => setSent(true)}
          />
        )}
      </details>
    </section>
  );
}
type Vehicle = { id: string; make: string; model: string };
type Review = {
  id: string;
  rating: number;
  note: string;
  response: string | null;
  status: string;
  authored?: boolean;
  canReply?: boolean;
  canAppeal?: boolean;
  settlement: { vehicle: Vehicle };
  appeal?: {
    status: string;
    note: string;
    decision: string | null;
    decisionNote: string | null;
  } | null;
};
type Row = {
  id: string;
  vehicle?: Vehicle;
  category?: string;
  note?: string;
  status?: string;
  decision?: string | null;
  decisionNote?: string | null;
  reviewedAt?: string | null;
  review?: Review;
} & Partial<Review>;
export function TrustCenter({ admin = false }: { admin?: boolean }) {
  const { t, date } = useLocale(),
    { status, data: session } = useSession();
  const identity = session?.user?.email ?? '';
  const [view, setView] = useState(admin ? 'adminReports' : 'deals'),
    [page, setPage] = useState(1),
    [filter, setFilter] = useState('OPEN'),
    [revision, setRevision] = useState(0);
  const [snapshot, setSnapshot] = useState<{ key: string; items: Row[]; total: number } | null>(
      null,
    ),
    [error, setError] = useState<MessageKey | null>(null),
    [notice, setNotice] = useState(false);
  const key = `${identity}:${view}:${filter}:${page}:${revision}`;
  const generation = useRef(0);
  useEffect(() => {
    const ticket = ++generation.current;
    setError(null);
    if (status !== 'authenticated') return;
    request(`?view=${view}&page=${page}&status=${filter}`)
      .then((data) => {
        if (ticket === generation.current) setSnapshot({ ...data, key });
      })
      .catch((e) => {
        if (ticket === generation.current) setError(errorKey(e.message));
      });
    return () => {
      generation.current++;
    };
  }, [key, status, view, filter, page]);
  const result = snapshot?.key === key ? snapshot : null;
  const done = () => {
    setNotice(true);
    setRevision((n) => n + 1);
  };
  const reviewBody = (r: Review) => (
    <>
      <p>
        {r.rating}/5 · {t(label(r.status))}
      </p>
      <p className="trust-text">{r.note}</p>
      {r.response && (
        <blockquote>
          {t('trustReply')}: {r.response}
        </blockquote>
      )}
    </>
  );
  return (
    <section className="container trust-page">
      <h1>{t(admin ? 'trustModeration' : 'trustCenter')}</h1>
      <p>{t(admin ? 'trustModerationHint' : 'trustCenterHint')}</p>
      {status === 'loading' ? (
        <p>{t('loading')}</p>
      ) : status !== 'authenticated' ? (
        <Link href="/login">{t('trustLogin')}</Link>
      ) : (
        <>
          <div className="trust-actions">
            {(admin
              ? ['adminReports', 'adminAppeals']
              : ['deals', 'reviews', 'reports', 'warnings']
            ).map((v) => (
              <Button
                key={v}
                variant={view === v ? 'default' : 'outline'}
                aria-pressed={view === v}
                onClick={() => {
                  setView(v);
                  setPage(1);
                  setNotice(false);
                }}
              >
                {t(label(v))}
              </Button>
            ))}
            <Button variant="outline" onClick={() => setRevision((n) => n + 1)}>
              {t('trustRefresh')}
            </Button>
          </div>
          {admin && (
            <label>
              {t('status')}
              <Select
                value={filter}
                onChange={(e) => {
                  setFilter(e.target.value);
                  setPage(1);
                }}
              >
                {['OPEN', 'CLOSED'].map((s) => (
                  <option value={s} key={s}>
                    {t(label(s))}
                  </option>
                ))}
              </Select>
            </label>
          )}
          {notice && <p role="status">{t('trustSaved')}</p>}
          {error && <p role="alert">{t(error)}</p>}
          {!result && !error ? (
            <p>{t('loading')}</p>
          ) : result?.items.length === 0 ? (
            <p>{t('trustEmpty')}</p>
          ) : (
            result?.items.map((row) => {
              const vehicle =
                row.vehicle ?? row.settlement?.vehicle ?? row.review?.settlement.vehicle;
              return (
                <article className="panel trust-item" key={row.id}>
                  {vehicle && (
                    <h2>
                      {vehicle.make} {vehicle.model}
                    </h2>
                  )}
                  {view === 'deals' ? (
                    <TrustForm action="rate" id={row.id} onDone={done} />
                  ) : view === 'reviews' ? (
                    <>
                      <p>{t(row.authored ? 'trustWritten' : 'trustReceived')}</p>
                      {reviewBody(row as Review)}
                      {row.canReply && (
                        <details>
                          <summary>{t('trustReply')}</summary>
                          <TrustForm action="reply" id={row.id} onDone={done} />
                        </details>
                      )}
                      {row.canAppeal && (
                        <details>
                          <summary>{t('trustAppeal')}</summary>
                          <TrustForm action="appeal" id={row.id} onDone={done} />
                        </details>
                      )}
                      {row.appeal && (
                        <p>
                          {t('trustAppeal')}: {t(label(row.appeal.status))}{' '}
                          {row.appeal.decision && t(label(row.appeal.decision))} ·{' '}
                          {row.appeal.decisionNote}
                        </p>
                      )}
                    </>
                  ) : (
                    <>
                      {row.category && <strong>{t(label(row.category))}</strong>}
                      <p className="trust-text">{row.note}</p>
                      {row.review && reviewBody(row.review)}
                      {row.status && <p>{t(label(row.status))}</p>}
                      {row.decision && (
                        <p>
                          {t(label(row.decision))} · {row.decisionNote}
                        </p>
                      )}
                      {row.reviewedAt && <p>{date(row.reviewedAt)}</p>}
                      {admin && row.status === 'OPEN' && (
                        <TrustForm
                          action={view === 'adminReports' ? 'decideReport' : 'decideAppeal'}
                          id={row.id}
                          onDone={done}
                        />
                      )}
                    </>
                  )}
                  {admin && vehicle && <Link href="/admin">{t('trustSaleManagement')}</Link>}
                </article>
              );
            })
          )}
          {result && (
            <div className="trust-actions">
              <Button disabled={page === 1} onClick={() => setPage(page - 1)}>
                {t('trustPrevious')}
              </Button>
              <span>
                {page} / {Math.max(1, Math.ceil(result.total / 20))}
              </span>
              <Button disabled={page * 20 >= result.total} onClick={() => setPage(page + 1)}>
                {t('trustNext')}
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
