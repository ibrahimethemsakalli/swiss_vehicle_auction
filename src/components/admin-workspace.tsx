'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { queueKinds, queueQuery, queueStatuses } from '../lib/admin-queue-rules';
import { useLocale, type MessageKey } from './providers';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Select, Textarea } from './ui/form-controls';
import { Dialog } from './ui/dialog';
import { Loading, ErrorState } from './common';
import { ReviewDialog } from './dashboards';
import { Settlements } from './settlements';
import { Disputes } from './disputes';
import { IdentityReviews } from './identity-reviews';
import type { VehicleView } from '../lib/market-types';
type Kind = (typeof queueKinds)[number];
type Row = {
  id: string;
  title: string;
  status: string;
  createdAt: string;
  reference?: string;
  note?: string;
  actor?: string;
  action?: string;
  requesterId?: string;
  canClaim?: boolean;
  noReviewer?: boolean;
  amount?: number;
  settlementId?: string | null;
  vehicle?: VehicleView & { vinChassis: string };
  assignment: null | {
    ownerId: string | null;
    version: number;
    owner: { email: string; suspendedAt: string | null; role: string } | null;
  };
};
type Result = {
  items: Row[];
  total: number;
  page: number;
  pageSize: number;
  adminId: string;
  now: string;
};
const defaults = {
  kind: 'queue' as Kind,
  q: '',
  status: 'PENDING_VERIFICATION',
  from: '',
  to: '',
  order: 'oldest' as 'oldest' | 'newest',
};
const names: Record<string, MessageKey> = {
  retention: 'rhQueue',
  NEEDS_INFO: 'pgInfo',
  KEPT: 'pgKept',
  WITHDRAWN: 'pgWithdrawn',
  audit: 'workAudit',
  UNVERIFIED: 'workUnverified',
  VERIFIED: 'workVerified',
  SUSPENDED: 'workSuspended',
  'admin.review': 'workListingEvent',
  'admin.identity': 'workIdentityEvent',
  'settlement.action': 'workSaleEvent',
  'dispute.reviewed': 'workDisputeEvent',
  'admin.assignment': 'workAssignmentEvent',
  claim: 'workClaim',
  release: 'workRelease',
};
export function AdminWorkspace() {
  const { data: session, status } = useSession(),
    { t } = useLocale();
  if (status === 'loading') return <Loading />;
  if (status !== 'authenticated')
    return (
      <section className="container trust-page">
        <Link href="/login">{t('signInRequired')}</Link>
      </section>
    );
  return <Workspace key={session?.user?.email} />;
}
function Workspace() {
  const { t, date, money } = useLocale();
  const [filter, setFilter] = useState(defaults),
    [applied, setApplied] = useState(defaults),
    [page, setPage] = useState(1),
    [revision, setRevision] = useState(0);
  const [state, setState] = useState<{ key: string; data: Result } | null>(null),
    [error, setError] = useState(0),
    [invalid, setInvalid] = useState(false),
    [selected, setSelected] = useState<Row | null>(null);
  const query = new URLSearchParams({ ...applied, page: String(page) }).toString(),
    key = query + ':' + revision;
  useEffect(() => {
    const controller = new AbortController();
    setError(0);
    fetch('/api/admin/work?' + query, { cache: 'no-store', signal: controller.signal })
      .then(async (r) => {
        if (!r.ok) throw Error(String(r.status));
        return r.json();
      })
      .then((data) => {
        if (!controller.signal.aborted) setState({ key, data });
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(Number(e.message) || 503);
      });
    return () => controller.abort();
  }, [key, query]);
  const data = state?.key === key ? state.data : null;
  useEffect(() => {
    if (selected && applied.kind !== 'queue')
      document
        .getElementById('work-detail')
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [selected, applied.kind]);
  const label = (s: string) => t(names[s] ?? (s as MessageKey));
  const refresh = () => {
    setSelected(null);
    setRevision((n) => n + 1);
  };
  if (error === 401 || error === 403) return <ErrorState code={error} />;
  return (
    <section className="container trust-page admin-workspace">
      <h1>{t('admin')}</h1>
      <p>{t('workIntro')}</p>
      <div className="trust-actions">
        <Link href="/admin/messages">{t('chatModeration')}</Link>
        <Link href="/admin/trust">{t('trustModeration')}</Link>
        <Link href="/admin/retention">{t('riTitle')}</Link>
        <Link href="/admin/support">{t('spAdmin')}</Link>
        <Link href="/admin/refunds">{t('rfAdmin')}</Link>
        <Link href="/admin/refunds/reconciliation">{t('rcTitle')}</Link>
      </div>
      <form
        className="work-filters"
        onSubmit={(e) => {
          e.preventDefault();
          if (!queueQuery.safeParse(filter).success) {
            setInvalid(true);
            return;
          }
          setInvalid(false);
          setApplied({ ...filter });
          setPage(1);
          setSelected(null);
          setRevision((n) => n + 1);
        }}
      >
        <label>
          {t('workQueue')}
          <Select
            value={filter.kind}
            onChange={(e) =>
              setFilter({
                ...defaults,
                kind: e.target.value as Kind,
                status: e.target.value === 'queue' ? 'PENDING_VERIFICATION' : '',
                order: e.target.value === 'audit' ? 'newest' : 'oldest',
              })
            }
          >
            {queueKinds.map((k) => (
              <option key={k} value={k}>
                {label(k)}
              </option>
            ))}
          </Select>
        </label>
        <label>
          {t('workSearch')}
          <Input
            value={filter.q}
            maxLength={100}
            onChange={(e) => setFilter({ ...filter, q: e.target.value })}
          />
        </label>
        <label>
          {t('status')}
          <Select
            value={filter.status}
            onChange={(e) => setFilter({ ...filter, status: e.target.value })}
          >
            <option value="">{t('workAll')}</option>
            {queueStatuses[filter.kind].map((s) => (
              <option key={s} value={s}>
                {filter.kind === 'retention'
                  ? t(
                      (
                        {
                          OPEN: 'pgOpen',
                          NEEDS_INFO: 'pgInfo',
                          KEPT: 'pgKept',
                          WITHDRAWN: 'pgWithdrawn',
                          RELEASED: 'pgReleased',
                        } as Record<string, MessageKey>
                      )[s] ?? 'pgUnknown',
                    )
                  : label(s)}
              </option>
            ))}
          </Select>
        </label>
        <label>
          {t('workFrom')}
          <Input
            type="date"
            value={filter.from}
            onInput={(e) => {
              const value = e.currentTarget.value;
              setFilter((current) => ({ ...current, from: value }));
            }}
          />
        </label>
        <label>
          {t('workTo')}
          <Input
            type="date"
            value={filter.to}
            onInput={(e) => {
              const value = e.currentTarget.value;
              setFilter((current) => ({ ...current, to: value }));
            }}
          />
        </label>
        <label>
          {t('workOrder')}
          <Select
            value={filter.order}
            onChange={(e) => setFilter({ ...filter, order: e.target.value as 'oldest' | 'newest' })}
          >
            <option value="oldest">{t('workOldest')}</option>
            <option value="newest">{t('workNewest')}</option>
          </Select>
        </label>
        <div className="trust-actions">
          <Button type="submit">{t('workApply')}</Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              const cleared = { ...defaults, kind: filter.kind, status: '' };
              setFilter(cleared);
              setApplied(cleared);
              setPage(1);
              setInvalid(false);
              refresh();
            }}
          >
            {t('workClear')}
          </Button>
          <Button type="button" variant="outline" onClick={refresh}>
            {t('trustRefresh')}
          </Button>
        </div>
      </form>
      <p className="fine-print">{t('workSearchHint')}</p>
      {invalid && <p role="alert">{t('workInvalid')}</p>}
      {error ? (
        <ErrorState retry={refresh} code={error} />
      ) : !data ? (
        <Loading />
      ) : (
        <>
          <p role="status">
            {t('workTotal')}: {data.total} · {t('workPage')}: {page} /{' '}
            {Math.max(1, Math.ceil(data.total / 20))}
          </p>
          {!data.items.length && <p>{t('trustEmpty')}</p>}
          {data.items.map((row) => (
            <article className="panel work-record" key={row.id}>
              <h2>
                {['audit', 'retention'].includes(applied.kind) ? label(row.title) : row.title}
              </h2>
              <p>
                {applied.kind === 'retention'
                  ? t(
                      (
                        {
                          OPEN: 'pgOpen',
                          NEEDS_INFO: 'pgInfo',
                          KEPT: 'pgKept',
                          WITHDRAWN: 'pgWithdrawn',
                          RELEASED: 'pgReleased',
                        } as Record<string, MessageKey>
                      )[row.status] ?? 'pgUnknown',
                    )
                  : label(row.status)}
                {row.amount !== undefined ? ' · ' + money(row.amount) : ''}
              </p>
              <p className="fine-print">
                {t('workRecord')}: {row.id}
              </p>
              {row.reference && (
                <p className="fine-print">
                  {t('workReference')}: {row.reference}
                </p>
              )}
              <p>
                {t('workCreated')}: {date(row.createdAt)} · {t('workAge')}:{' '}
                {Math.max(
                  0,
                  Math.floor((Date.parse(data.now) - Date.parse(row.createdAt)) / 86400000),
                )}{' '}
                {t('workDays')}
              </p>
              {applied.kind === 'audit' ? (
                <>
                  <p>
                    {t('workOperator')}: {row.actor ?? t('notProvided')}
                  </p>
                  {row.action && <p>{label(row.action)}</p>}
                  <p className="trust-text">{row.note}</p>
                </>
              ) : (
                <>
                  <p>
                    {t('workOwner')}: {row.assignment?.owner?.email ?? t('workUnassigned')}
                  </p>
                  {applied.kind === 'retention' && (
                    <>
                      <p>{t('rhAssignmentNotice')}</p>
                      {row.noReviewer && <p>{t('rhNoReviewer')}</p>}
                      <p className="break-all">
                        {t('pgRequester')}: {row.requesterId}
                      </p>
                      {row.requesterId === data.adminId && <p>{t('pgSecond')}</p>}
                      <Link href={`/admin/retention?request=${encodeURIComponent(row.id)}`}>
                        {t('rhOpen')}
                      </Link>
                    </>
                  )}
                  {(applied.kind !== 'retention' ||
                    row.canClaim ||
                    row.assignment?.ownerId === data.adminId) && (
                    <Assignment
                      key={row.id + ':' + (row.assignment?.version ?? 0)}
                      kind={applied.kind}
                      row={row}
                      adminId={data.adminId}
                      saved={refresh}
                    />
                  )}
                  {((applied.kind === 'queue' && row.status === 'PENDING_VERIFICATION') ||
                    applied.kind === 'settlements' ||
                    applied.kind === 'disputes' ||
                    (applied.kind === 'identities' && row.status === 'UNVERIFIED') ||
                    (applied.kind === 'payments' && row.settlementId)) && (
                    <Button variant="outline" onClick={() => setSelected(row)}>
                      {t('workOpen')}
                    </Button>
                  )}
                </>
              )}
            </article>
          ))}
          <div className="trust-actions">
            <Button
              disabled={page === 1}
              onClick={() => {
                setPage(page - 1);
                setSelected(null);
              }}
            >
              {t('trustPrevious')}
            </Button>
            <Button
              disabled={page * 20 >= data.total}
              onClick={() => {
                setPage(page + 1);
                setSelected(null);
              }}
            >
              {t('trustNext')}
            </Button>
          </div>
        </>
      )}
      {selected && (
        <div className="work-detail" id="work-detail">
          <Button variant="outline" onClick={() => setSelected(null)}>
            {t('workClose')}
          </Button>
          {applied.kind === 'queue' && selected.vehicle && (
            <Dialog
              open
              onOpenChange={(open) => {
                if (!open) setSelected(null);
              }}
            >
              <ReviewDialog vehicle={selected.vehicle} demo={false} onSaved={refresh} />
            </Dialog>
          )}
          {(applied.kind === 'settlements' || applied.kind === 'payments') && (
            <Settlements
              key={selected.id}
              recordId={applied.kind === 'payments' ? selected.settlementId! : selected.id}
            />
          )}
          {applied.kind === 'disputes' && <Disputes key={selected.id} recordId={selected.id} />}
          {applied.kind === 'identities' && (
            <IdentityReviews key={selected.id} recordId={selected.id} />
          )}
        </div>
      )}
    </section>
  );
}
function Assignment({
  kind,
  row,
  adminId,
  saved,
}: {
  kind: Kind;
  row: Row;
  adminId: string;
  saved: () => void;
}) {
  const { t } = useLocale();
  const [note, setNote] = useState(''),
    [busy, setBusy] = useState(false),
    [failed, setFailed] = useState(false);
  const mine = row.assignment?.ownerId === adminId,
    available =
      !row.assignment?.ownerId ||
      row.assignment.owner?.suspendedAt ||
      row.assignment.owner?.role !== 'ADMIN';
  if (!mine && !available) return null;
  return (
    <details>
      <summary>{t(mine ? 'workRelease' : 'workClaim')}</summary>
      <form
        className="trust-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          setBusy(true);
          setFailed(false);
          try {
            const r = await fetch('/api/admin/work', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                kind,
                id: row.id,
                action: mine ? 'release' : 'claim',
                version: row.assignment?.version ?? 0,
                note,
              }),
            });
            if (!r.ok) throw Error();
            saved();
          } catch {
            setFailed(true);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          {t('workNote')}
          <Textarea
            required
            minLength={5}
            maxLength={500}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
        {failed && <p role="alert">{t('workConflict')}</p>}
        <Button disabled={busy}>{t(mine ? 'workRelease' : 'workClaim')}</Button>
      </form>
    </details>
  );
}
