'use client';
import React, { useEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { useLocale, type MessageKey } from './providers';
type Item = {
  id: string;
  reason: string;
  status: string;
  version: number;
  amountMinor: number;
  currency: string;
  canReview?: boolean;
  canManage?: boolean;
  canReconcile?: boolean;
  captureId?: string;
  evidenceReady?: boolean;
  canReopen?: boolean;
  activities?: { action: string; reason: string; createdAt: string }[];
  blocks?: { id: string; kind: string }[];
  timing?: { informationDueAt: string | null; informationOverdue: boolean };
  receipts?: { reference: string; amountMinor: number }[];
  publicDecision?: { outcome: string; reason: string } | null;
  decisions?: { reviewerId: string; outcome: string; reason: string }[];
};
type Data = {
  cases: Item[];
  captures: { id: string; amount: string; make: string; model: string }[];
  more: boolean;
  policyReady: boolean;
};
type Props = {
  admin: boolean;
  t: (k: MessageKey) => string;
  data: Data | null;
  detail: Item | null;
  reason: string;
  capture: string;
  outcome: string;
  busy: boolean;
  error: string;
  stale: boolean;
  page: number;
  setReason: (s: string) => void;
  setCapture: (s: string) => void;
  setOutcome: (s: string) => void;
  open: (id?: string) => void;
  turn: (page: number) => void;
  submit: () => void;
};
const statusKey = (s: string): MessageKey =>
  (
    ({
      REQUESTED: 'rfRequested',
      IN_REVIEW: 'rfReview',
      APPROVED: 'rfApproved',
      REJECTED: 'rfRejected',
      NEEDS_INFORMATION: 'rfNeedsInformation',
    }) as Record<string, MessageKey>
  )[s] ?? 'rfUnknown';
const errorKey = (s: string): MessageKey =>
  (
    ({
      CONFLICT: 'rfConflict',
      POLICY_CHANGED: 'rfPolicy',
      POLICY_UNCONFIGURED: 'rfPolicy',
      FORBIDDEN: 'rfDenied',
      UNAUTHORIZED: 'rfDenied',
      NOT_FOUND: 'rfDenied',
      INVALID_BODY: 'rfInvalid',
      TOO_LARGE: 'rfInvalid',
      RATE_LIMITED: 'rfRate',
      CAPTURE_BINDING_REQUIRED: 'rfUnavailable',
      EVIDENCE_REQUIRED: 'rfEvidenceRequired',
      REVIEW_REQUIRED: 'rfBlocked',
      REOPEN_REQUIRED: 'rfReopenRequired',
      REVIEW_LIMIT: 'rfReviewLimit',
      DIFFERENT_REVIEWER_REQUIRED: 'rfDifferentReviewer',
    }) as Record<string, MessageKey>
  )[s] ?? 'rfUnavailable';
/** Pure view permits focused four-language rendering tests without session/network dependencies. */
export function RefundPanel(p: Props) {
  const { t } = p;
  return (
    <section className="mx-auto max-w-4xl min-w-0 p-4 space-y-4 break-words">
      <h1 className="text-2xl font-bold">{t(p.admin ? 'rfAdmin' : 'rfTitle')}</h1>
      <p>{t('rfHint')}</p>
      <p className="rounded border p-3">{t('rfApprovedPolicy')}</p>
      <p>{t('rfTimingPolicy')}</p>
      <p className="rounded bg-amber-50 p-3">{t('rfNoMoney')}</p>
      {p.error && <p role="alert">{t(errorKey(p.error))}</p>}
      <button className="rounded border p-3" disabled={p.busy} onClick={() => p.open(p.detail?.id)}>
        {t('rfRefresh')}
      </button>
      {p.busy && <p role="status">{t('loading')}</p>}
      {p.detail ? (
        <>
          <button className="rounded border p-3" disabled={p.busy} onClick={() => p.open()}>
            {t('rfBack')}
          </button>
          <h2 className="font-semibold break-all">{p.detail.id}</h2>
          <p>
            {t(statusKey(p.detail.status))} · {p.detail.currency}{' '}
            {(p.detail.amountMinor / 100).toFixed(2)}
          </p>
          <p className="whitespace-pre-wrap">{p.detail.reason}</p>
          {p.detail.publicDecision && (
            <p className="whitespace-pre-wrap border rounded p-3">
              {p.detail.publicDecision.reason}
            </p>
          )}
          {p.detail.timing?.informationDueAt && (
            <p>
              {t('rfInformationDue')}:{' '}
              <time>{p.detail.timing.informationDueAt.slice(0, 10)} UTC</time>
            </p>
          )}
          {p.detail.timing?.informationOverdue && <p role="status">{t('rfInformationReminder')}</p>}
          {p.detail.receipts?.map((r) => (
            <p key={r.reference}>
              {t('rfReceipt')}: CHF {(r.amountMinor / 100).toFixed(2)} ·{' '}
              <span className="break-all">{r.reference}</span>
            </p>
          ))}
          {!!p.detail.blocks?.length && <p role="alert">{t('rfBlocked')}</p>}
          <ul className="space-y-3">
            {p.detail.activities?.map((a, i) => (
              <li key={i} className="border rounded p-3 whitespace-pre-wrap">
                {a.reason}
              </li>
            ))}
          </ul>
          {p.admin && (
            <ul className="space-y-3">
              {p.detail.decisions?.map((d, i) => (
                <li key={i} className="border rounded p-3">
                  <strong>{t(d.outcome === 'APPROVE' ? 'rfApprove' : 'rfReject')}</strong>
                  <p className="whitespace-pre-wrap">{d.reason}</p>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <>
          <ul className="space-y-3">
            {p.data?.cases.map((item) => (
              <li key={item.id} className="border rounded p-3">
                <button
                  className="underline break-all text-left"
                  disabled={p.busy}
                  onClick={() => p.open(item.id)}
                >
                  {item.id}
                </button>
                <p>
                  {t(statusKey(item.status))} · {item.currency}{' '}
                  {(item.amountMinor / 100).toFixed(2)}
                </p>
                <p className="line-clamp-2">{item.reason}</p>
              </li>
            ))}
          </ul>
          {p.data && !p.data.cases.length && <p>{t('rfEmpty')}</p>}
          <nav className="flex flex-wrap gap-3" aria-label={t('rfPages')}>
            <button disabled={p.busy || p.page <= 1} onClick={() => p.turn(p.page - 1)}>
              {t('rfPrevious')}
            </button>
            <span>{p.page}</span>
            <button disabled={p.busy || !p.data?.more} onClick={() => p.turn(p.page + 1)}>
              {t('rfNext')}
            </button>
          </nav>
        </>
      )}
      {p.admin && p.data?.policyReady === false && <p>{t('rfPolicy')}</p>}
      {p.admin && p.detail?.canManage && !p.detail.evidenceReady && (
        <p>{t('rfEvidenceRequired')}</p>
      )}
      {((!p.admin &&
        (!p.detail || p.detail.status === 'NEEDS_INFORMATION' || p.detail.canReopen)) ||
        (p.admin && p.detail)) && (
        <form
          noValidate
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            p.submit();
          }}
        >
          {!p.admin && !p.detail && (
            <label className="block">
              {t('rfCapture')}
              <select
                className="block w-full min-w-0 rounded border p-3"
                value={p.capture}
                disabled={p.busy}
                onChange={(e) => p.setCapture(e.target.value)}
              >
                <option value="">{t('rfChoose')}</option>
                {p.data?.captures.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.make} {c.model} · CHF {c.amount}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="block">
            {t('rfReason')}
            <textarea
              className="block w-full min-w-0 rounded border p-3"
              rows={5}
              maxLength={2000}
              value={p.reason}
              disabled={p.busy}
              onChange={(e) => p.setReason(e.target.value)}
              aria-describedby="refund-reason-help"
            />
          </label>
          <p id="refund-reason-help">{t('rfReasonHelp')}</p>
          {p.admin &&
            ['APPROVE', 'REJECT', 'REQUEST_INFORMATION', 'STATUS_UPDATE'].includes(p.outcome) && (
              <p>{t('rfPublicReason')}</p>
            )}
          {(p.admin || p.detail?.canReopen) && (
            <label className="block">
              {t('rfDecision')}
              <select
                className="block w-full min-w-0 rounded border p-3"
                value={p.outcome}
                disabled={p.busy}
                onChange={(e) => p.setOutcome(e.target.value)}
              >
                {p.admin ? (
                  <>
                    <option value="APPROVE" disabled={!p.detail?.evidenceReady}>
                      {t('rfApprove')}
                    </option>
                    <option value="REJECT">{t('rfReject')}</option>
                    <option value="REQUEST_INFORMATION">{t('rfAskInformation')}</option>
                    <option value="CONFIRM_EVIDENCE">{t('rfConfirmEvidence')}</option>
                    <option value="STATUS_UPDATE">{t('rfStatusUpdate')}</option>
                    {p.detail?.canReconcile && (
                      <>
                        <option value="CHARGEBACK">{t('rfChargeback')}</option>
                        <option value="CAPTURE_CONFLICT">{t('rfCaptureConflict')}</option>
                        <option value="ACCOUNT_CONFLICT">{t('rfAccountConflict')}</option>
                        {p.detail.blocks?.map((b) => (
                          <option key={b.id} value={'RESOLVE_BLOCK:' + b.id}>
                            {t('rfResolveBlock')} · {b.id}
                          </option>
                        ))}
                      </>
                    )}
                  </>
                ) : (
                  <>
                    <option value="EQUIVALENT">{t('rfEquivalent')}</option>
                    <option value="NEW_EVIDENCE">{t('rfNewEvidence')}</option>
                    <option value="ERROR">{t('rfErrorReview')}</option>
                  </>
                )}
              </select>
            </label>
          )}
          <button
            className="w-full sm:w-auto rounded bg-slate-900 text-white px-4 py-3 whitespace-normal"
            disabled={
              p.busy ||
              p.stale ||
              (p.admin
                ? ['APPROVE', 'REJECT'].includes(p.outcome)
                  ? !p.detail?.canReview ||
                    (p.outcome === 'APPROVE' &&
                      (!p.detail.evidenceReady || !!p.detail.blocks?.length))
                  : ['REQUEST_INFORMATION', 'CONFIRM_EVIDENCE', 'STATUS_UPDATE'].includes(p.outcome)
                    ? !p.detail?.canManage
                    : !p.detail?.canReconcile
                : !p.detail && !p.capture)
            }
          >
            {t(p.admin ? 'rfSave' : 'rfSend')}
          </button>
        </form>
      )}
    </section>
  );
}
export function Refunds({ admin = false }: { admin?: boolean }) {
  const { t } = useLocale(),
    { status, data: session } = useSession();
  const sessionId = (session?.user as { id?: string } | undefined)?.id;
  const [data, setData] = useState<Data | null>(null),
    [detail, setDetail] = useState<Item | null>(null),
    [reason, setReason] = useState(''),
    [capture, setCapture] = useState(''),
    [outcome, setOutcome] = useState('APPROVE'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [stale, setStale] = useState(false),
    [page, setPage] = useState(1);
  const seq = useRef(0),
    retry = useRef({ body: '', id: '' });
  const drafts = useRef<Record<string, string>>({});
  async function load(id?: string, nextPage = page) {
    const run = ++seq.current;
    setBusy(true);
    setError('');
    try {
      const r = await fetch(
          `/api/refunds?${id ? 'id=' + encodeURIComponent(id) : `admin=${admin}&page=${nextPage}`}`,
          { cache: 'no-store' },
        ),
        v = await r.json();
      if (run !== seq.current) return;
      if (!r.ok) throw Error(v.error);
      setReason(drafts.current[id ?? 'new'] ?? '');
      if (id) {
        setDetail(v);
        setOutcome(
          admin
            ? v.evidenceReady
              ? 'APPROVE'
              : 'CONFIRM_EVIDENCE'
            : v.canReopen
              ? 'EQUIVALENT'
              : 'PROVIDE_INFORMATION',
        );
      } else {
        setData(v);
        setDetail(null);
        setPage(nextPage);
      }
      setStale(false);
    } catch (e) {
      if (run === seq.current) setError(e instanceof Error ? e.message : 'UNAVAILABLE');
    } finally {
      if (run === seq.current) setBusy(false);
    }
  }
  useEffect(() => {
    setData(null);
    setDetail(null);
    setReason('');
    setCapture('');
    retry.current = { body: '', id: '' };
    drafts.current = {};
    if (status === 'authenticated') void load(undefined, 1);
    return () => {
      seq.current++;
    };
  }, [status, admin, sessionId]);
  async function submit() {
    if (busy || stale) return;
    const note = reason.trim();
    if (note.length < 20 || note.length > 2000 || (!admin && !detail && !capture)) {
      setError('INVALID_BODY');
      return;
    }
    const body = admin
      ? !['APPROVE', 'REJECT'].includes(outcome)
        ? {
            action: outcome.split(':')[0],
            caseId: detail?.id,
            expectedVersion: detail?.version,
            reason: note,
            ...(outcome.startsWith('RESOLVE_BLOCK:') ? { blockId: outcome.split(':')[1] } : {}),
          }
        : {
            action: 'decide',
            caseId: detail?.id,
            expectedVersion: detail?.version,
            outcome,
            reason: note,
          }
      : detail?.status === 'NEEDS_INFORMATION'
        ? {
            action: 'PROVIDE_INFORMATION',
            caseId: detail.id,
            expectedVersion: detail.version,
            reason: note,
          }
        : {
            action: 'request',
            captureId: detail?.captureId ?? capture,
            reason: note,
            ...(detail?.canReopen ? { previousCaseId: detail.id, reviewBasis: outcome } : {}),
          };
    const signature = JSON.stringify(body);
    if (retry.current.body !== signature)
      retry.current = { body: signature, id: crypto.randomUUID() };
    setBusy(true);
    setError('');
    const run = ++seq.current;
    try {
      const r = await fetch('/api/refunds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, requestId: retry.current.id }),
      });
      const v = await r.json();
      if (run !== seq.current) return;
      if (!r.ok) throw Error(v.error);
      delete drafts.current[detail?.id ?? 'new'];
      setReason('');
      retry.current = { body: '', id: '' };
      await load(v.id);
    } catch (e) {
      if (run !== seq.current) return;
      const code = e instanceof Error ? e.message : 'UNAVAILABLE';
      setError(code);
      if (code === 'CONFLICT' || code === 'POLICY_CHANGED') setStale(true);
    } finally {
      if (run === seq.current) setBusy(false);
    }
  }
  if (status === 'loading') return <p>{t('loading')}</p>;
  if (status !== 'authenticated')
    return (
      <section className="p-4">
        <h1>{t(admin ? 'rfAdmin' : 'rfTitle')}</h1>
        <Link href={`/login?next=${admin ? '/admin/refunds' : '/refunds'}`}>{t('rfSignIn')}</Link>
      </section>
    );
  return (
    <RefundPanel
      {...{
        admin,
        t,
        data,
        detail,
        reason,
        capture,
        outcome,
        busy,
        error,
        stale,
        page,
        setCapture,
        setOutcome,
      }}
      setReason={(value) => {
        drafts.current[detail?.id ?? 'new'] = value;
        setReason(value);
      }}
      open={(id) => void load(id)}
      turn={(n) => {
        setCapture('');
        void load(undefined, n);
      }}
      submit={() => void submit()}
    />
  );
}
