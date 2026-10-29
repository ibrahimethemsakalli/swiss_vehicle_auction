'use client';
import { useState } from 'react';
import { useLocale, type MessageKey } from './providers';
import { Button } from './ui/button';
export type ReviewRow = {
  id: string;
  version: number;
  status: string;
  requests: {
    id: string;
    version: number;
    status: string;
    requesterId: string;
    note: string;
    reasonCode: string;
    evidence: { type: string; id: string }[];
  }[];
};
const statusKeys: Record<string, MessageKey> = {
  ACTIVE: 'pgActive',
  RELEASED: 'pgReleased',
  OPEN: 'pgOpen',
  NEEDS_INFO: 'pgInfo',
  KEPT: 'pgKept',
  WITHDRAWN: 'pgWithdrawn',
};
type Evidence = { type: string; id: string; text: string; date: string };
export function RetentionReviewCard({
  row,
  viewerId,
  busy,
  submit,
}: {
  row: ReviewRow;
  viewerId: string;
  busy: boolean;
  submit: (cmd: unknown) => Promise<void>;
}) {
  const { t } = useLocale();
  const [detail, setDetail] = useState<{
    blocker: string | null;
    canAct: boolean;
    evidence: Evidence[];
  } | null>(null);
  const [loading, setLoading] = useState(false),
    [failed, setFailed] = useState(false),
    [invalid, setInvalid] = useState(false);
  const [note, setNote] = useState(''),
    [reference, setReference] = useState(''),
    [reason, setReason] = useState('NEW_EVIDENCE');
  const [events, setEvents] = useState<
      {
        id: string;
        kind: string;
        actorId: string;
        createdAt: string;
        payload: {
          note?: string;
          command?: { note?: string; evidence?: { type: string; id: string }[] };
        };
      }[]
    >([]),
    [next, setNext] = useState<string | null>(null),
    [historyLoaded, setHistoryLoaded] = useState(false);
  const req = row.requests[0],
    open = req && ['OPEN', 'NEEDS_INFO'].includes(req.status),
    own = req?.requesterId === viewerId;
  async function load(history = false, after?: string) {
    setLoading(true);
    setFailed(false);
    try {
      const r = await fetch(
        `/api/admin/retention/protections?${history ? 'history' : 'detail'}=${row.id}${after ? '&after=' + encodeURIComponent(after) : ''}`,
        { cache: 'no-store' },
      );
      if (!r.ok) throw Error();
      const data = await r.json();
      if (history) {
        setEvents(data.events);
        setNext(data.next);
        setHistoryLoaded(true);
      } else setDetail(data);
    } catch {
      setFailed(true);
      if (history) {
        setEvents([]);
        setHistoryLoaded(false);
        setNext(null);
      } else setDetail(null);
    } finally {
      setLoading(false);
    }
  }
  function act(action: string) {
    setInvalid(false);
    const e = detail?.evidence.find((e) => e.type + ':' + e.id === reference);
    if (
      note.trim().length < 10 ||
      note.trim().length > 1000 ||
      (['request', 'supplement'].includes(action) && !e)
    ) {
      setInvalid(true);
      return;
    }
    const common = {
      action,
      commandId: crypto.randomUUID(),
      id: action === 'request' ? row.id : req.id,
      version: action === 'request' ? row.version : req.version,
      note,
    };
    void submit({
      ...common,
      ...(action === 'request' ? { reasonCode: reason } : {}),
      ...(['request', 'supplement'].includes(action)
        ? { evidence: [{ type: e!.type, id: e!.id }] }
        : {}),
    });
  }
  return (
    <div className="grid gap-3 mt-3 min-w-0">
      <strong>{t(statusKeys[row.status] ?? 'pgUnknown')}</strong>
      {req && (
        <div className="border-l-2 pl-2">
          <p>{t(statusKeys[req.status] ?? 'pgUnknown')}</p>
          <p className="break-all">
            {t('pgRequester')}: {req.requesterId}
          </p>
          <p className="whitespace-pre-wrap">{req.note}</p>
          {req.evidence.map((e) => (
            <p className="break-all" key={e.type + e.id}>
              {t(e.type === 'MESSAGE' ? 'pgMessage' : 'pgAppointment')}: {e.id}
            </p>
          ))}
        </div>
      )}
      <Button
        disabled={busy || loading}
        className="h-auto whitespace-normal"
        onClick={() => void load()}
      >
        {t('pgDetails')}
      </Button>
      <Button
        disabled={busy || loading}
        className="h-auto whitespace-normal"
        onClick={() => void load(true)}
      >
        {t('pgHistory')}
      </Button>
      {failed && <p role="alert">{t('rpError')}</p>}
      {detail && (
        <>
          <p>
            {t(
              detail.blocker === 'AUTOMATIC_PROTECTION'
                ? 'pgAuto'
                : detail.blocker
                  ? 'pgUncertain'
                  : 'pgClear',
            )}
          </p>
          {!detail.canAct && <p role="alert">{t('pgParticipant')}</p>}
          {row.status === 'ACTIVE' && detail.canAct && (
            <>
              {(!open || own) && (
                <>
                  <label className="grid gap-1">
                    {t('pgReasonCode')}
                    <select
                      className="border rounded p-2 w-full min-w-0"
                      value={reason}
                      disabled={busy || loading || !!open}
                      onChange={(e) => setReason(e.target.value)}
                    >
                      {(
                        [
                          'NEW_EVIDENCE',
                          'WRONG_CONVERSATION',
                          'REASON_CHANGED',
                          'CASE_CHANGED',
                        ] as const
                      ).map((r, i) => (
                        <option key={r} value={r}>
                          {t(
                            (
                              [
                                'pgNewEvidence',
                                'pgWrong',
                                'pgReasonChanged',
                                'pgCaseChanged',
                              ] as const
                            )[i],
                          )}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="grid gap-1">
                    {t('pgEvidence')}
                    <select
                      className="border rounded p-2 w-full min-w-0"
                      disabled={busy || loading}
                      value={reference}
                      onChange={(e) => setReference(e.target.value)}
                    >
                      <option value="">{t('pgSelect')}</option>
                      {detail.evidence.map((e) => (
                        <option key={e.type + e.id} value={e.type + ':' + e.id}>
                          {t(e.type === 'MESSAGE' ? 'pgMessage' : 'pgAppointment')} {e.id}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              )}
              <ul className="space-y-2">
                {detail.evidence
                  .filter(
                    (e) =>
                      e.type + ':' + e.id === reference ||
                      req?.evidence.some((r) => r.id === e.id && r.type === e.type),
                  )
                  .map((e) => (
                    <li className="border p-2 whitespace-pre-wrap break-words" key={e.type + e.id}>
                      <p className="break-all">{e.id}</p>
                      <p>{e.date}</p>
                      <p>{e.text}</p>
                    </li>
                  ))}
              </ul>
              <label className="grid gap-1">
                {t('pgNote')}
                <textarea
                  className="border rounded p-2 w-full min-w-0"
                  rows={3}
                  maxLength={1000}
                  disabled={busy || loading}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </label>
              {invalid && <p role="alert">{t('pgValidation')}</p>}
              {!open ? (
                <Button
                  disabled={busy || loading}
                  className="h-auto whitespace-normal"
                  onClick={() => act('request')}
                >
                  {t('pgRequest')}
                </Button>
              ) : own ? (
                <>
                  <p>{t('pgSecond')}</p>
                  <Button
                    disabled={busy || loading}
                    className="h-auto whitespace-normal"
                    onClick={() => act('supplement')}
                  >
                    {t('pgSupplement')}
                  </Button>
                  <Button
                    disabled={busy || loading}
                    className="h-auto whitespace-normal"
                    onClick={() => act('withdraw')}
                  >
                    {t('pgWithdraw')}
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    disabled={busy || loading}
                    className="h-auto whitespace-normal"
                    onClick={() => act('info')}
                  >
                    {t('pgAskInfo')}
                  </Button>
                  <Button
                    disabled={busy || loading}
                    className="h-auto whitespace-normal"
                    onClick={() => act('keep')}
                  >
                    {t('pgKeep')}
                  </Button>
                  <p>{t('pgApproveNotice')}</p>
                  <Button
                    disabled={busy || loading || !!detail.blocker || req.status !== 'OPEN'}
                    className="h-auto whitespace-normal"
                    onClick={() => act('approve')}
                  >
                    {t('pgApprove')}
                  </Button>
                </>
              )}
            </>
          )}
        </>
      )}
      {historyLoaded && (
        <div>
          <h3 className="font-bold">{t('pgHistory')}</h3>
          <ul className="space-y-2">
            {events.map((e) => (
              <li className="border p-2 break-words" key={e.id}>
                <p>
                  {t(
                    (
                      {
                        CREATE: 'rpCreate',
                        LEGACY_CREATE: 'pgLegacyCreate',
                        LEGACY_REVIEW: 'pgLegacyReview',
                        REQUEST: 'pgRequest',
                        SUPPLEMENT: 'pgSupplement',
                        WITHDRAW: 'pgWithdraw',
                        INFO: 'pgAskInfo',
                        KEEP: 'pgKeep',
                        RELEASED: 'pgReleased',
                      } as Record<string, MessageKey>
                    )[e.kind] ?? 'pgUnknown',
                  )}
                </p>
                <p>{e.createdAt}</p>
                <p className="break-all">
                  {t('rpActor')}: {e.actorId}
                </p>
                <p className="whitespace-pre-wrap">{e.payload.note ?? e.payload.command?.note}</p>
                {e.payload.command?.evidence?.map((r) => (
                  <p className="break-all" key={r.id}>
                    {t(r.type === 'MESSAGE' ? 'pgMessage' : 'pgAppointment')}: {r.id}
                  </p>
                ))}
              </li>
            ))}
          </ul>
          {next && (
            <Button disabled={busy || loading} onClick={() => void load(true, next)}>
              {t('rpNext')}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
