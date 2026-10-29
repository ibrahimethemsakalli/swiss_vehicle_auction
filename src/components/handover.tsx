'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import {
  blankHandover,
  handoverChecks,
  handoverValues,
  handoverPayload,
  type HandoverPayload,
} from '../lib/handover-rules';
import { useLocale, type MessageKey } from './providers';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Select, Textarea } from './ui/form-controls';
import { Loading, ErrorState, StatusBadge } from './common';
type Revision = {
  id: string;
  version: number;
  payload: HandoverPayload;
  snapshot: {
    make: string;
    model: string;
    maskedVin: string;
    stammnummer: string;
    price: string;
    currency: string;
  };
  contentHash: string;
  createdByRole: string;
  createdAt: string;
  buyerAcknowledgedAt: string | null;
  sellerAcknowledgedAt: string | null;
};
type Data = {
  settlementId: string;
  vehicle: string;
  saleStatus: string;
  price: number;
  party: string | null;
  fee: { amount: number; currency: string; status: string; simulated: boolean };
  blocked: boolean;
  canSave: boolean;
  canAcknowledge: boolean;
  current: Revision | null;
  history: Revision[];
  total: number;
  page: number;
  asOf: string;
};
const errKeys: Record<string, MessageKey> = {
  CONFLICT: 'handoverConflict',
  HANDOVER_LOCKED: 'handoverReadOnly',
  DISPUTE_OPEN: 'disputePausesCapture',
  HANDOVER_LIMIT: 'handoverLimit',
  RATE_LIMITED: 'handoverLimit',
  HANDOVER_INCOMPLETE: 'handoverIncomplete',
  VERIFICATION_REQUIRED: 'trustVerify',
  FORBIDDEN: 'trustForbidden',
};
export function HandoverPage({ settlementId }: { settlementId: string }) {
  const { status, data } = useSession(),
    { t } = useLocale();
  if (status === 'loading') return <Loading />;
  if (status !== 'authenticated')
    return (
      <section className="container trust-page">
        <Link href="/login">{t('signInRequired')}</Link>
      </section>
    );
  return <Handover key={settlementId + ':' + data?.user?.email} settlementId={settlementId} />;
}
function Handover({ settlementId }: { settlementId: string }) {
  const { t, money, number, locale } = useLocale();
  const [page, setPage] = useState(1),
    [refresh, setRefresh] = useState(0),
    [state, setState] = useState<{ key: string; data: Data } | null>(null),
    [error, setError] = useState(0);
  const key = `${settlementId}:${page}:${refresh}`;
  useEffect(() => {
    const controller = new AbortController();
    setError(0);
    fetch(`/api/handover?settlementId=${encodeURIComponent(settlementId)}&page=${page}`, {
      cache: 'no-store',
      signal: controller.signal,
    })
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
  }, [key, settlementId, page]);
  const data = state?.key === key ? state.data : null;
  const stamp = (s: string) =>
    new Intl.DateTimeFormat(`${locale}-CH`, {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Europe/Zurich',
    }).format(new Date(s));
  const [failure, setFailure] = useState<MessageKey | null>(null),
    [busy, setBusy] = useState(false),
    [confirmed, setConfirmed] = useState(false);
  useEffect(() => setConfirmed(false), [data?.current?.id]);
  async function send(command: unknown) {
    if (busy) return;
    setBusy(true);
    setFailure(null);
    try {
      const r = await fetch('/api/handover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(command),
      });
      const b = await r.json();
      if (!r.ok) throw Error(b.error);
      setConfirmed(false);
      setRefresh((n) => n + 1);
      return true;
    } catch (e) {
      setFailure(errKeys[e instanceof Error ? e.message : ''] ?? 'handoverFailed');
      return false;
    } finally {
      setBusy(false);
    }
  }
  function summary(r: Revision) {
    return (
      <article className="handover-summary panel">
        <h2>
          {t('handoverVersion')} {r.version} ·{' '}
          {t(r.buyerAcknowledgedAt && r.sellerAcknowledgedAt ? 'handoverBoth' : 'handoverPending')}
        </h2>
        <p>
          {r.snapshot.make} {r.snapshot.model} · {money(Number(r.snapshot.price))}
        </p>
        <p>
          {t('stammnummer')}: {r.snapshot.stammnummer} · {t('vin')}: {r.snapshot.maskedVin}
        </p>
        <dl className="handover-grid">
          <dt>{t('handoverDate')}</dt>
          <dd>{r.payload.date || t('notProvided')}</dd>
          <dt>{t('mileage')}</dt>
          <dd>
            {r.payload.mileage === null ? t('notProvided') : number(r.payload.mileage) + ' km'}
          </dd>
          <dt>{t('handoverKeyCount')}</dt>
          <dd>{r.payload.keyCount ?? t('notProvided')}</dd>
          {handoverChecks.map((k) => (
            <div className="handover-check" key={k}>
              <dt>{t(`handoverCheck_${k}` as MessageKey)}</dt>
              <dd>{t(`handoverAnswer_${r.payload[k]}` as MessageKey)}</dd>
            </div>
          ))}
        </dl>
        <p className="trust-text">{r.payload.note || t('handoverNoNote')}</p>
        <p>
          {t('handoverSavedBy')}:{' '}
          {t(r.createdByRole === 'BUYER' ? 'handoverBuyer' : 'handoverSeller')} ·{' '}
          {stamp(r.createdAt)}
        </p>
        <p>
          {t('handoverBuyer')}:{' '}
          {r.buyerAcknowledgedAt ? stamp(r.buyerAcknowledgedAt) : t('handoverNotAcknowledged')}
        </p>
        <p>
          {t('handoverSeller')}:{' '}
          {r.sellerAcknowledgedAt ? stamp(r.sellerAcknowledgedAt) : t('handoverNotAcknowledged')}
        </p>
        <p className="fine-print">
          {t('handoverHash')}: {r.contentHash}
        </p>
      </article>
    );
  }
  if (error) return <ErrorState code={error} retry={() => setRefresh((n) => n + 1)} />;
  if (!data) return <Loading />;
  return (
    <section className="container trust-page handover-page">
      <div className="handover-no-print trust-actions">
        <Link href="/dashboard">{t('garage')}</Link>
        <Button
          variant="outline"
          onClick={() => {
            setConfirmed(false);
            setRefresh((n) => n + 1);
          }}
        >
          {t('trustRefresh')}
        </Button>
        <Button variant="outline" disabled={!data.current} onClick={() => window.print()}>
          {t('handoverPrint')}
        </Button>
      </div>
      <h1>{t('handoverTitle')}</h1>
      <p className="notice">{t('handoverDisclaimer')}</p>
      {data.fee.simulated && <p className="notice">{t('handoverSimulated')}</p>}
      <h2>{data.vehicle}</h2>
      <p>
        {t('handoverSaleRef')}: {data.settlementId}
      </p>
      <p>
        {t('status')}: <StatusBadge status={data.saleStatus} />
      </p>
      <section className="panel">
        <h2>{t('handoverPayment')}</h2>
        <p>
          {number(data.fee.amount)} {data.fee.currency} · <StatusBadge status={data.fee.status} />
        </p>
        <p>{t('handoverPaymentHint')}</p>
        <p>
          {t('handoverAsOf')}: {stamp(data.asOf)}
        </p>
      </section>
      {data.current ? summary(data.current) : <p>{t('handoverEmpty')}</p>}
      <div className="handover-no-print">
        {data.blocked && <p className="notice">{t('handoverDisputed')}</p>}
        {!data.canSave && !data.canAcknowledge && <p>{t('handoverReadOnly')}</p>}
        {failure && <p role="alert">{t(failure)}</p>}
        {data.canSave && (
          <details>
            <summary>{t(data.current ? 'handoverRevise' : 'handoverCreate')}</summary>
            <p>{t('handoverRevisionHint')}</p>
            <HandoverForm
              key={data.current?.version ?? 0}
              initial={data.current?.payload ?? blankHandover}
              busy={busy}
              save={(payload) =>
                send({ action: 'save', settlementId, version: data.current?.version ?? 0, payload })
              }
            />
          </details>
        )}
        {data.current &&
          data.party &&
          data.canSave &&
          !data.canAcknowledge &&
          !(data.party === 'BUYER'
            ? data.current.buyerAcknowledgedAt
            : data.current.sellerAcknowledgedAt) && <p>{t('handoverIncomplete')}</p>}
        {data.canAcknowledge && (
          <form
            className="panel trust-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (confirmed)
                void send({
                  action: 'acknowledge',
                  settlementId,
                  version: data.current!.version,
                  confirmed: true,
                });
            }}
          >
            <label className="check-label">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                required
              />
              {t('handoverAcknowledgeHint')}
            </label>
            <Button disabled={busy || !confirmed}>{t('handoverAcknowledge')}</Button>
          </form>
        )}
        {data.total > 0 && (
          <details className="handover-history">
            <summary>
              {t('handoverHistory')} ({data.total})
            </summary>
            {data.history.map((r) => (
              <div key={r.id}>{summary(r)}</div>
            ))}
            <div className="trust-actions">
              <Button disabled={page === 1} onClick={() => setPage(page - 1)}>
                {t('trustPrevious')}
              </Button>
              <span>
                {page} / {Math.ceil(data.total / 10)}
              </span>
              <Button disabled={page * 10 >= data.total} onClick={() => setPage(page + 1)}>
                {t('trustNext')}
              </Button>
            </div>
          </details>
        )}
      </div>
    </section>
  );
}
function HandoverForm({
  initial,
  busy,
  save,
}: {
  initial: HandoverPayload;
  busy: boolean;
  save: (payload: HandoverPayload) => Promise<unknown>;
}) {
  const { t } = useLocale();
  const [value, setValue] = useState({ ...initial }),
    [invalid, setInvalid] = useState(false);
  return (
    <form
      className="trust-form"
      onSubmit={(e) => {
        e.preventDefault();
        const result = handoverPayload.safeParse(value);
        if (!result.success) {
          setInvalid(true);
          return;
        }
        setInvalid(false);
        void save(result.data);
      }}
    >
      <label>
        {t('handoverDate')}
        <Input
          type="date"
          value={value.date}
          onInput={(e) => {
            const date = e.currentTarget.value;
            setValue((v) => ({ ...v, date }));
          }}
        />
      </label>
      <label>
        {t('mileage')}
        <Input
          type="number"
          min={0}
          max={2000000}
          step={1}
          value={value.mileage ?? ''}
          onChange={(e) =>
            setValue({ ...value, mileage: e.target.value === '' ? null : Number(e.target.value) })
          }
        />
      </label>
      <label>
        {t('handoverKeyCount')}
        <Input
          type="number"
          min={0}
          max={20}
          step={1}
          value={value.keyCount ?? ''}
          onChange={(e) =>
            setValue({ ...value, keyCount: e.target.value === '' ? null : Number(e.target.value) })
          }
        />
      </label>
      {handoverChecks.map((k) => (
        <label key={k}>
          {t(`handoverCheck_${k}` as MessageKey)}
          <Select value={value[k]} onChange={(e) => setValue({ ...value, [k]: e.target.value })}>
            {handoverValues.map((answer) => (
              <option key={answer} value={answer}>
                {t(`handoverAnswer_${answer}` as MessageKey)}
              </option>
            ))}
          </Select>
        </label>
      ))}
      <label>
        {t('handoverNote')}
        <Textarea
          maxLength={2000}
          rows={4}
          value={value.note}
          onChange={(e) => setValue({ ...value, note: e.target.value })}
        />
      </label>
      <p>{t('handoverIncomplete')}</p>
      {invalid && <p role="alert">{t('handoverFailed')}</p>}
      <Button disabled={busy}>{t('handoverSave')}</Button>
    </form>
  );
}
