'use client';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { useEffect, useRef, useState } from 'react';
import { useLocale, type MessageKey } from './providers';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { LocalProxyLedger } from './local-proxy-ledger';
const errors: Record<string, MessageKey> = {
  FORBIDDEN: 'lpForbidden',
  UNAUTHORIZED: 'signInRequired',
  LOCAL_PROXY_DISABLED: 'lpDisabled',
  SELF_BID: 'lpSeller',
  BID_TOO_LOW: 'proxyTooLow',
  LIMIT_NOT_HIGHER: 'proxyRaiseOnly',
  AUCTION_ENDED: 'proxyEnded',
  AUCTION_NOT_DUE: 'lpNotDue',
  SALE_NOT_READY: 'lpSaleNotReady',
  SALE_COMPLETED: 'lpCompleted',
  REFUND_NOT_READY: 'lpRefundNotReady',
  REFUND_EXISTS: 'lpRefundExists',
  REFUND_DECIDED: 'lpRefundDecided',
  REFUND_REASON_INVALID: 'lpRefundReasonInvalid',
  LEADER_HOLD_EXPIRED: 'proxyHoldExpired',
  INVALID_INPUT: 'proxyInvalid',
  REQUEST_CONFLICT: 'proxyConflict',
  LOCAL_PROXY_QUOTA: 'lpQuota',
  FIXTURE_ACCOUNTS_REQUIRED: 'lpAccounts',
};
async function request(query = '', body?: unknown) {
  const r = await fetch('/api/local-proxy' + query, {
    cache: 'no-store',
    ...(body
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      : {}),
  });
  const data = await r.json();
  if (!r.ok) throw Error(data.error);
  return data;
}
type Detail = {
  refundCase: null | {
    reason: string;
    status: 'PENDING' | 'APPROVED' | 'REJECTED';
    decisionNote: string | null;
    refund: null | { amountCents: number; currency: string; refundedAt: string };
  };
  status: 'OPEN' | 'WON' | 'NO_BIDS' | 'REVIEW' | 'CANCELLED' | 'COMPLETED';
  capture: null | { amountCents: number; currency: string; capturedAt: string };
  winner: 'NONE' | 'YOU' | 'OTHER';
  auctionId: string;
  priceCents: string | null;
  startCents: string;
  incrementCents: string;
  endsAt: string;
  serverNow: string;
  version: number;
  closed: boolean;
  blocked: boolean;
  canBid: boolean;
  role: 'SELLER' | 'BUYER';
  leader: 'NONE' | 'YOU' | 'OTHER';
  own: null | {
    maximumCents: string;
    hold: {
      status: 'AUTHORIZED' | 'RELEASED' | 'EXPIRED' | 'CAPTURED';
      amountCents: number;
      currency: string;
      expiresAt: string;
    };
  };
};
export function LocalProxyWorkspace() {
  const { status, data } = useSession(),
    { t } = useLocale();
  return status === 'loading' ? (
    <p>{t('loading')}</p>
  ) : status !== 'authenticated' ? (
    <div className="container py-8">
      <Link href="/login?next=/local-proxy">{t('signInRequired')}</Link>
    </div>
  ) : (
    <Rooms key={data?.user?.email ?? ''} />
  );
}
function Rooms() {
  const [showLedger, setShowLedger] = useState(false);
  const { t } = useLocale(),
    [rooms, setRooms] = useState<{ auctionId: string; createdAt: string }[]>([]),
    [canCreate, setCanCreate] = useState(false),
    [selected, setSelected] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [loaded, setLoaded] = useState(false);
  const alive = useRef(true),
    nonce = useRef('');
  async function load() {
    try {
      const data = await request();
      if (alive.current) {
        setRooms(data.rooms);
        setCanCreate(data.canCreate);
        setLoaded(true);
        setError('');
      }
    } catch (e) {
      if (alive.current) {
        setError(e instanceof Error ? e.message : '');
        setRooms([]);
        setCanCreate(false);
        setSelected('');
      }
    }
  }
  useEffect(() => {
    alive.current = true;
    void load();
    return () => {
      alive.current = false;
    };
  }, []);
  return (
    <section className="container max-w-3xl py-8 min-w-0 break-words">
      <h1 className="text-2xl font-bold">{t('lpTitle')}</h1>
      <p className="notice my-4">{t('lpNotice')}</p>
      <p className="my-3">{t('lpRoles')}</p>
      {canCreate && (
        <>
          <Button variant="outline" onClick={() => setShowLedger((v) => !v)}>
            {t('llTitle')}
          </Button>
          {showLedger && <LocalProxyLedger />}
        </>
      )}
      <div className="flex flex-wrap gap-3">
        <Button variant="outline" disabled={busy} onClick={() => void load()}>
          {t('chatRefresh')}
        </Button>
        {canCreate && (
          <Button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError('');
              nonce.current ||= crypto.randomUUID();
              try {
                const data = await request('', { action: 'create', requestId: nonce.current });
                if (alive.current) {
                  nonce.current = '';
                  setSelected(data.auctionId);
                  await load();
                }
              } catch (e) {
                if (alive.current) setError(e instanceof Error ? e.message : '');
              } finally {
                if (alive.current) setBusy(false);
              }
            }}
          >
            {t('lpCreate')}
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="notice my-3">
          {t(errors[error] ?? 'lpFailed')}
        </p>
      )}
      {loaded && !rooms.length && <p className="my-3">{t('lpEmpty')}</p>}
      <label className="block my-4">
        {t('lpSelect')}
        <select
          className="field w-full"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
        >
          <option value="">—</option>
          {rooms.map((r, i) => (
            <option key={r.auctionId} value={r.auctionId}>
              {i + 1}. {r.auctionId.slice(0, 8)}
            </option>
          ))}
        </select>
      </label>
      {selected && <Auction key={selected} id={selected} />}
    </section>
  );
}
function Auction({ id }: { id: string }) {
  const [refundReason, setRefundReason] = useState('');
  const refundNonce = useRef({ value: '', id: '' });
  const { t, money } = useLocale(),
    [data, setData] = useState<Detail | null>(null),
    [maximum, setMaximum] = useState(''),
    [error, setError] = useState(''),
    [loadError, setLoadError] = useState(''),
    [busy, setBusy] = useState(false),
    [saved, setSaved] = useState(false),
    [clock, setClock] = useState(Date.now()),
    [offset, setOffset] = useState(0);
  const alive = useRef(true),
    revision = useRef(0),
    nonce = useRef({ value: '', id: '' });
  async function load() {
    const rev = ++revision.current;
    try {
      const d: Detail = await request('?auctionId=' + id);
      if (alive.current && rev === revision.current) {
        setData((old) => (!old || d.version >= old.version ? d : old));
        setOffset(Date.parse(d.serverNow) - Date.now());
        setLoadError('');
      }
    } catch (e) {
      if (alive.current && rev === revision.current) {
        setData(null);
        setLoadError(e instanceof Error ? e.message : 'LOCAL_PROXY_FAILED');
      }
    }
  }
  useEffect(() => {
    alive.current = true;
    void load();
    const poll = setInterval(() => {
        if (!document.hidden) void load();
      }, 5000),
      tick = setInterval(() => setClock(Date.now()), 1000);
    return () => {
      alive.current = false;
      revision.current++;
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [id]);
  const closed = !!data && (data.closed || clock + offset >= Date.parse(data.endsAt));
  const holdStatus =
    data?.own?.hold.status === 'AUTHORIZED' && clock + offset >= Date.parse(data.own.hold.expiresAt)
      ? 'EXPIRED'
      : data?.own?.hold.status;
  const saleNonce = useRef({ action: '', id: '' });
  async function submitRefund(action: 'requestRefund' | 'approveRefund' | 'rejectRefund') {
    const reason = refundReason.trim();
    setError('');
    setSaved(false);
    if (reason.length < 10 || reason.length > 400) {
      setError('REFUND_REASON_INVALID');
      return;
    }
    setBusy(true);
    const value = JSON.stringify({ action, reason });
    if (refundNonce.current.value !== value || !refundNonce.current.id)
      refundNonce.current = { value, id: crypto.randomUUID() };
    try {
      await request('', { action, auctionId: id, requestId: refundNonce.current.id, reason });
      if (alive.current) {
        refundNonce.current = { value: '', id: '' };
        setRefundReason('');
        await load();
      }
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : '');
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function finish(action: 'close' | 'cancel' | 'renew' | 'confirm') {
    setBusy(true);
    setError('');
    setSaved(false);
    try {
      if (saleNonce.current.action !== action || !saleNonce.current.id)
        saleNonce.current = { action, id: crypto.randomUUID() };
      await request('', {
        action,
        auctionId: id,
        ...(['renew', 'confirm'].includes(action) ? { requestId: saleNonce.current.id } : {}),
      });
      saleNonce.current = { action: '', id: '' };
      if (alive.current) await load();
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : '');
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  return (
    <div className="panel p-4">
      <h2 className="font-bold">{t('lpAuction')}</h2>
      {loadError && <p role="alert">{t(errors[loadError] ?? 'lpFailed')}</p>}
      {error && (
        <p role="alert" className="notice my-3">
          {t(errors[error] ?? 'lpFailed')}
        </p>
      )}
      {saved && <p role="status">{t('lpSaved')}</p>}
      {data && (
        <>
          <p className="my-3">
            {t('proxyLeader')}:{' '}
            {t(data.leader === 'NONE' ? 'lpNoLeader' : data.leader === 'YOU' ? 'lpYou' : 'lpOther')}{' '}
            · {money(Number(data.priceCents ?? data.startCents) / 100)}
          </p>
          <p>
            {t('proxyIncrement')}: {money(Number(data.incrementCents) / 100)}
          </p>
          <p role="status">
            {t(
              data.status === 'COMPLETED'
                ? 'lpCompleted'
                : data.status === 'CANCELLED'
                  ? 'lpCancelled'
                  : data.status === 'WON'
                    ? 'lpWon'
                    : data.status === 'NO_BIDS'
                      ? 'lpNoBids'
                      : data.status === 'REVIEW'
                        ? 'lpReview'
                        : closed
                          ? 'lpPendingClose'
                          : data.blocked
                            ? 'proxyHoldExpired'
                            : 'lpOpen',
            )}
          </p>
          {['WON', 'COMPLETED'].includes(data.status) && (
            <p>
              {t('lpWinner')}: {t(data.winner === 'YOU' ? 'lpYou' : 'lpOther')}
            </p>
          )}
          <p>
            {t('lpRemaining')}:{' '}
            {closed ? 0 : Math.max(0, Math.ceil((Date.parse(data.endsAt) - clock - offset) / 1000))}{' '}
            s
          </p>
          {data.capture && (
            <p role="status" className="notice my-3">
              {t('lpFeeCaptured')}: {money(data.capture.amountCents / 100)}
            </p>
          )}
          {data.role === 'SELLER' ? (
            <div className="my-4">
              <p className="notice">{t('lpSeller')}</p>
              <div className="flex flex-wrap gap-3 mt-3">
                <Button
                  disabled={busy || data.status !== 'OPEN' || !closed}
                  onClick={() => void finish('close')}
                >
                  {t('lpClose')}
                </Button>
                <Button
                  variant="outline"
                  disabled={busy || ['CANCELLED', 'COMPLETED'].includes(data.status)}
                  onClick={() => void finish('cancel')}
                >
                  {t('lpCancel')}
                </Button>
                {data.status === 'WON' && (
                  <Button disabled={busy || data.blocked} onClick={() => void finish('confirm')}>
                    {t('lpConfirm')}
                  </Button>
                )}
              </div>
              {data.status === 'WON' && data.blocked && (
                <p className="notice mt-3">{t('lpRenewRequired')}</p>
              )}
            </div>
          ) : (
            <>
              <h3 className="font-bold mt-4">{t('lpOwn')}</h3>
              {data.own ? (
                <>
                  <p>{money(Number(data.own.maximumCents) / 100)}</p>
                  <p>
                    {t('lpHold')}: {money(data.own.hold.amountCents / 100)} ·{' '}
                    {t(
                      holdStatus === 'CAPTURED'
                        ? 'lpCaptured'
                        : holdStatus === 'RELEASED'
                          ? 'lpReleased'
                          : holdStatus === 'EXPIRED'
                            ? 'lpExpired'
                            : 'lpAuthorized',
                    )}
                  </p>
                </>
              ) : (
                <p>{t('lpNoLimit')}</p>
              )}
              {data.status === 'WON' && data.winner === 'YOU' && (
                <Button
                  disabled={busy || holdStatus === 'AUTHORIZED'}
                  onClick={() => void finish('renew')}
                >
                  {t('lpRenew')}
                </Button>
              )}
              <form
                noValidate
                className="grid gap-3 mt-4"
                onSubmit={async (e) => {
                  e.preventDefault();
                  setBusy(true);
                  setSaved(false);
                  setError('');
                  if (nonce.current.value !== maximum || !nonce.current.id)
                    nonce.current = { value: maximum, id: crypto.randomUUID() };
                  try {
                    await request('', {
                      action: 'bid',
                      auctionId: id,
                      requestId: nonce.current.id,
                      maximum,
                    });
                    if (alive.current) {
                      nonce.current = { value: '', id: '' };
                      setMaximum('');
                      await load();
                      setSaved(true);
                    }
                  } catch (e) {
                    if (alive.current) setError(e instanceof Error ? e.message : '');
                  } finally {
                    if (alive.current) setBusy(false);
                  }
                }}
              >
                <label>
                  {t('lpMaximum')}
                  <Input
                    inputMode="decimal"
                    autoComplete="off"
                    maxLength={12}
                    value={maximum}
                    disabled={busy || closed || !data.canBid}
                    onChange={(e) => {
                      setMaximum(e.target.value);
                      setSaved(false);
                      setError('');
                    }}
                  />
                </label>
                <Button
                  disabled={
                    busy ||
                    closed ||
                    !data.canBid ||
                    (data.leader === 'YOU' && holdStatus === 'EXPIRED') ||
                    !maximum.trim()
                  }
                >
                  {t('lpSubmit')}
                </Button>
              </form>
            </>
          )}
          {data.status === 'COMPLETED' && (data.role === 'SELLER' || data.winner === 'YOU') && (
            <section className="border rounded-xl p-3 my-4 min-w-0">
              <h3 className="font-bold">{t('lpRefundTitle')}</h3>
              <p className="my-2 text-sm">{t('lpRefundNotice')}</p>
              {data.refundCase && (
                <>
                  <p role="status">
                    {t(
                      data.refundCase.status === 'PENDING'
                        ? 'lpRefundPending'
                        : data.refundCase.status === 'APPROVED'
                          ? 'lpRefundApproved'
                          : 'lpRefundRejected',
                    )}
                  </p>
                  <p className="whitespace-pre-wrap break-words my-2">
                    {t('lpRefundReason')}: {data.refundCase.reason}
                  </p>
                  {data.refundCase.decisionNote && (
                    <p className="whitespace-pre-wrap break-words my-2">
                      {t('lpRefundDecision')}: {data.refundCase.decisionNote}
                    </p>
                  )}
                  {data.refundCase.refund && (
                    <p>
                      {t('lpRefundAmount')}: {money(data.refundCase.refund.amountCents / 100)}
                    </p>
                  )}
                </>
              )}
              {((data.winner === 'YOU' && !data.refundCase) ||
                (data.role === 'SELLER' && data.refundCase?.status === 'PENDING')) && (
                <form
                  noValidate
                  className="grid gap-3 mt-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (data.winner === 'YOU') void submitRefund('requestRefund');
                  }}
                >
                  <label>
                    {t(data.role === 'SELLER' ? 'lpRefundDecision' : 'lpRefundReason')}
                    <textarea
                      className="field w-full min-h-24"
                      maxLength={400}
                      value={refundReason}
                      disabled={busy}
                      onChange={(e) => {
                        setRefundReason(e.target.value);
                        setError('');
                      }}
                    />
                  </label>
                  <p className="text-sm">{t('lpRefundReasonInvalid')}</p>
                  {data.role === 'SELLER' ? (
                    <div className="flex flex-wrap gap-3">
                      <Button
                        type="button"
                        disabled={busy}
                        onClick={() => void submitRefund('approveRefund')}
                      >
                        {t('lpRefundApprove')}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={busy}
                        onClick={() => void submitRefund('rejectRefund')}
                      >
                        {t('lpRefundReject')}
                      </Button>
                    </div>
                  ) : (
                    <Button type="submit" disabled={busy}>
                      {t('lpRefundRequest')}
                    </Button>
                  )}
                </form>
              )}
            </section>
          )}
          <p className="my-4 text-sm">{t('lpLifecycle')}</p>
        </>
      )}
      <Button variant="outline" disabled={busy} onClick={() => void load()}>
        {t('chatRefresh')}
      </Button>
    </div>
  );
}
