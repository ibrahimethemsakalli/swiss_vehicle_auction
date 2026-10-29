'use client';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale, type MessageKey } from './providers';
import { Button } from './ui/button';
type Conversation = { id: string; role: string; vehicle: { make: string; model: string } };
type Message = { id: string; own: boolean; body: string | null; createdAt: string };
type Appointment = { id: string; own: boolean; startsAt: string; location: string; status: string };
type Thread = {
  id: string;
  vehicleName: string;
  role: string;
  blocked: boolean;
  ownBlock: boolean;
  canSend: boolean;
  messages: Message[];
  appointments: Appointment[];
  next: string | null;
};
const errorKeys: Record<string, MessageKey> = {
  CHAT_BLOCKED: 'chatBlocked',
  CHAT_UNAVAILABLE: 'chatUnavailable',
  CHAT_CONFLICT: 'chatConflict',
  CHAT_DATE: 'chatDateError',
  VERIFICATION_REQUIRED: 'chatVerify',
  RATE_LIMITED: 'chatRate',
  FORBIDDEN: 'chatForbidden',
  UNAUTHORIZED: 'signInRequired',
  CHAT_INVALID: 'chatInvalid',
  INVALID_BODY: 'chatInvalid',
};
const statusKeys: Record<string, MessageKey> = {
  PENDING: 'chatPending',
  ACCEPTED: 'chatAccepted',
  DECLINED: 'chatDeclined',
  CANCELLED: 'chatCancelled',
  EXPIRED: 'chatExpired',
};
async function request(query: string, body?: unknown) {
  const res = await fetch(`/api/messages${query}`, {
    cache: 'no-store',
    ...(body
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      : {}),
  });
  const value = await res.json();
  if (!res.ok) throw Error(value.error);
  return value;
}
export function Messages() {
  const { status, data: session } = useSession(),
    { t, locale } = useLocale();
  const [conversations, setConversations] = useState<Conversation[]>([]),
    [canModerate, setCanModerate] = useState(false),
    [next, setNext] = useState<string | null>(null);
  const [vehicle, setVehicle] = useState(''),
    [selected, setSelected] = useState(''),
    [thread, setThread] = useState<Thread | null>(null);
  const [body, setBody] = useState(''),
    [location, setLocation] = useState('');
  const [report, setReport] = useState(''),
    [category, setCategory] = useState('SPAM'),
    [note, setNote] = useState('');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [success, setSuccess] = useState(false),
    [loaded, setLoaded] = useState(false);
  const revision = useRef(0),
    listRevision = useRef(0),
    sessionRevision = useRef(0),
    nonce = useRef({ key: '', id: '' });
  const loadList = useCallback(async (before?: string) => {
    const rev = ++listRevision.current;
    const data = await request(before ? `?before=${before}` : '');
    if (rev !== listRevision.current) return;
    setCanModerate(data.canModerate === true);
    setConversations((old) =>
      before
        ? [
            ...old,
            ...data.conversations.filter((c: Conversation) => !old.some((x) => x.id === c.id)),
          ]
        : data.conversations,
    );
    setNext(data.next);
    setLoaded(true);
  }, []);
  const loadThread = useCallback(async (cid: string, before?: string) => {
    const rev = ++revision.current;
    const data: Thread = await request(
      `?conversationId=${cid}${before ? `&before=${before}` : ''}`,
    );
    if (rev !== revision.current) return;
    setThread((old) =>
      before && old?.id === cid
        ? {
            ...data,
            messages: [
              ...data.messages,
              ...old.messages.filter((m) => !data.messages.some((n) => n.id === m.id)),
            ],
          }
        : data,
    );
  }, []);
  useEffect(() => {
    const rev = ++sessionRevision.current;
    setConversations([]);
    setCanModerate(false);
    setThread(null);
    setSelected('');
    setError('');
    setLoaded(false);
    setVehicle(new URLSearchParams(window.location.search).get('vehicle') ?? '');
    if (status === 'authenticated')
      void loadList().catch((e) => {
        if (rev === sessionRevision.current) setError(e.message);
      });
    return () => {
      sessionRevision.current++;
      listRevision.current++;
      revision.current++;
    };
  }, [status, session?.user?.email, loadList]);
  useEffect(() => {
    setThread(null);
    setBody('');
    setReport('');
    setLocation('');
    setSuccess(false);
    setError('');
    if (!selected) return;
    const load = () => void loadThread(selected).catch((e) => setError(e.message));
    load();
    // Refresh only the latest page; older history stays in view until explicitly refreshed.
    const timer = setInterval(() => {
      if (!document.hidden && !document.querySelector('[data-chat-history="true"]')) load();
    }, 15000);
    return () => {
      clearInterval(timer);
      revision.current++;
    };
  }, [selected, loadThread]);
  const [history, setHistory] = useState(false);
  async function act(command: Record<string, unknown>, done?: () => void) {
    setError('');
    setSuccess(false);
    setBusy(true);
    const rev = sessionRevision.current;
    try {
      const key = JSON.stringify(command);
      if (['send', 'propose'].includes(String(command.action))) {
        if (nonce.current.key !== key) nonce.current = { key, id: crypto.randomUUID() };
        command = { ...command, requestId: nonce.current.id };
      }
      const result = await request('', command);
      if (rev !== sessionRevision.current) return;
      if (command.action === 'start') {
        setSelected(result.id);
        setHistory(false);
        await loadList();
      } else if (selected) await loadThread(selected);
      done?.();
      setSuccess(true);
      window.dispatchEvent(new Event('notifications-changed'));
    } catch (e) {
      if (rev === sessionRevision.current) setError(e instanceof Error ? e.message : 'CHAT_FAILED');
    } finally {
      if (rev === sessionRevision.current) setBusy(false);
    }
  }
  const date = (value: string) =>
    new Intl.DateTimeFormat(`${locale}-CH`, {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Europe/Zurich',
    }).format(new Date(value));
  return (
    <section className="container chat-page">
      <h1>{t('chatTitle')}</h1>
      <p>{t('chatPrivacy')}</p>
      {status === 'loading' ? (
        <p>{t('loading')}</p>
      ) : status !== 'authenticated' ? (
        <Link href="/login?next=/messages">{t('signInRequired')}</Link>
      ) : (
        <>
          {vehicle && (
            <Button
              disabled={busy}
              onClick={() => void act({ action: 'start', vehicleId: vehicle })}
            >
              {t('chatStart')}
            </Button>
          )}
          {canModerate && (
            <p>
              <Link href="/admin/messages">{t('chatModeration')}</Link>
            </p>
          )}
          {error && <p role="alert">{t(errorKeys[error] ?? 'chatError')}</p>}
          {success && <p role="status">{t('chatSaved')}</p>}
          <div className="chat-layout">
            <aside className="chat-conversations" aria-label={t('chatTitle')}>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => void loadList().catch((e) => setError(e.message))}
              >
                {t('chatRefresh')}
              </Button>
              {loaded && !conversations.length && <p>{t('chatEmpty')}</p>}
              {conversations.map((c) => (
                <button
                  key={c.id}
                  className={selected === c.id ? 'chat-thread selected' : 'chat-thread'}
                  disabled={busy}
                  onClick={() => {
                    setSelected(c.id);
                    setHistory(false);
                  }}
                >
                  <strong>
                    {c.vehicle.make} {c.vehicle.model}
                  </strong>
                  <span>{t(c.role === 'buyer' ? 'chatBuyer' : 'chatSeller')}</span>
                </button>
              ))}
              {next && (
                <Button
                  disabled={busy}
                  onClick={() => void loadList(next).catch((e) => setError(e.message))}
                >
                  {t('chatMore')}
                </Button>
              )}
            </aside>
            <div className="chat-content" data-chat-history={history ? 'true' : 'false'}>
              {!selected ? (
                <p>{t('chatChoose')}</p>
              ) : !thread ? (
                <p>{t('loading')}</p>
              ) : (
                <>
                  <h2>{thread.vehicleName}</h2>
                  <div className="chat-actions">
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() => {
                        setHistory(false);
                        void loadThread(selected).catch((e) => setError(e.message));
                      }}
                    >
                      {t('chatRefresh')}
                    </Button>
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        void act({
                          action: 'block',
                          conversationId: selected,
                          blocked: !thread.ownBlock,
                        })
                      }
                    >
                      {t(thread.ownBlock ? 'chatUnblock' : 'chatBlock')}
                    </Button>
                  </div>
                  {!thread.canSend && (
                    <p role="status">{t(thread.blocked ? 'chatBlocked' : 'chatVerify')}</p>
                  )}
                  {thread.next && (
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() => {
                        setHistory(true);
                        void loadThread(selected, thread.next!).catch((e) => setError(e.message));
                      }}
                    >
                      {t('chatOlder')}
                    </Button>
                  )}
                  <ol className="chat-messages">
                    {thread.messages.map((m) => (
                      <li key={m.id} className={m.own ? 'chat-message own' : 'chat-message'}>
                        <small>
                          {t(m.own ? 'chatYou' : 'chatOther')} · {date(m.createdAt)}
                        </small>
                        <p>{m.body ?? t('chatHidden')}</p>
                        {!m.own && (
                          <Button
                            variant="ghost"
                            disabled={busy}
                            onClick={() => {
                              setReport(m.id);
                              setNote('');
                              setSuccess(false);
                            }}
                          >
                            {t('chatReport')}
                          </Button>
                        )}
                      </li>
                    ))}
                  </ol>
                  {report && (
                    <form
                      className="chat-form"
                      noValidate
                      onSubmit={(e) => {
                        e.preventDefault();
                        void act(
                          {
                            action: 'report',
                            conversationId: selected,
                            messageId: report,
                            category,
                            note,
                          },
                          () => setReport(''),
                        );
                      }}
                    >
                      <h3>{t('chatReport')}</h3>
                      <label>
                        {t('chatCategory')}
                        <select value={category} onChange={(e) => setCategory(e.target.value)}>
                          {(['SPAM', 'ABUSE', 'FRAUD', 'PERSONAL_DATA', 'OTHER'] as const).map(
                            (k) => (
                              <option key={k} value={k}>
                                {t(
                                  (
                                    {
                                      SPAM: 'chatSpam',
                                      ABUSE: 'chatAbuse',
                                      FRAUD: 'chatFraud',
                                      PERSONAL_DATA: 'chatPersonal',
                                      OTHER: 'chatOtherReason',
                                    } as const
                                  )[k],
                                )}
                              </option>
                            ),
                          )}
                        </select>
                      </label>
                      <label>
                        {t('chatReason')}
                        <textarea
                          value={note}
                          maxLength={1000}
                          onChange={(e) => setNote(e.target.value)}
                        />
                      </label>
                      <Button disabled={busy}>{t('chatSubmitReport')}</Button>
                      <Button type="button" variant="ghost" onClick={() => setReport('')}>
                        {t('chatClose')}
                      </Button>
                    </form>
                  )}
                  <form
                    className="chat-form"
                    noValidate
                    onSubmit={(e) => {
                      e.preventDefault();
                      void act({ action: 'send', conversationId: selected, body }, () => {
                        setBody('');
                        nonce.current = { key: '', id: '' };
                      });
                    }}
                  >
                    <label>
                      {t('chatMessage')}
                      <textarea
                        maxLength={2000}
                        value={body}
                        disabled={!thread.canSend || busy}
                        onChange={(e) => setBody(e.target.value)}
                      />
                    </label>
                    <Button disabled={!thread.canSend || busy || !body.trim()}>
                      {t('chatSend')}
                    </Button>
                  </form>
                  <h2>{t('chatAppointments')}</h2>
                  <p>{t('chatAppointmentNote')}</p>
                  <p>{t('chatReminderNote')}</p>
                  <p>{t('chatCalendarNote')}</p>
                  <ul className="chat-messages">
                    {thread.appointments.map((a) => (
                      <li key={a.id} className="chat-message">
                        <strong>{date(a.startsAt)} (Europe/Zurich)</strong>
                        <p>{a.location}</p>
                        <p>{t(statusKeys[a.status] ?? 'chatExpired')}</p>
                        <div className="chat-actions">
                          {a.status === 'ACCEPTED' &&
                            new Date(a.startsAt).getTime() > Date.now() && (
                              <a
                                className="underline break-words"
                                href={`/api/appointments/calendar?id=${a.id}&lang=${locale}`}
                                download
                              >
                                {t('chatCalendarDownload')}
                              </a>
                            )}
                          {a.status === 'PENDING' &&
                            !a.own &&
                            thread.canSend &&
                            (['ACCEPTED', 'DECLINED'] as const).map((decision) => (
                              <Button
                                key={decision}
                                disabled={busy}
                                onClick={() =>
                                  void act({
                                    action: 'appointment',
                                    conversationId: selected,
                                    id: a.id,
                                    decision,
                                  })
                                }
                              >
                                {t(decision === 'ACCEPTED' ? 'chatAccept' : 'chatDecline')}
                              </Button>
                            ))}
                          {['PENDING', 'ACCEPTED'].includes(a.status) && (
                            <Button
                              variant="outline"
                              disabled={busy}
                              onClick={() =>
                                void act({
                                  action: 'appointment',
                                  conversationId: selected,
                                  id: a.id,
                                  decision: 'CANCELLED',
                                })
                              }
                            >
                              {t('chatCancel')}
                            </Button>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                  <form
                    className="chat-form"
                    noValidate
                    onSubmit={(e) => {
                      e.preventDefault();
                      const form = e.currentTarget;
                      const d = new Date(String(new FormData(form).get('startsAt') ?? ''));
                      if (!Number.isFinite(d.getTime())) {
                        setSuccess(false);
                        setError('CHAT_DATE');
                        return;
                      }
                      void act(
                        {
                          action: 'propose',
                          conversationId: selected,
                          startsAt: d.toISOString(),
                          location,
                        },
                        () => {
                          form.reset();
                          setLocation('');
                          nonce.current = { key: '', id: '' };
                        },
                      );
                    }}
                  >
                    <label>
                      {t('chatWhen')} ({Intl.DateTimeFormat().resolvedOptions().timeZone})
                      <input
                        type="datetime-local"
                        name="startsAt"
                        key={selected}
                        disabled={!thread.canSend || busy}
                      />
                    </label>
                    <label>
                      {t('chatLocation')}
                      <input
                        value={location}
                        maxLength={200}
                        disabled={!thread.canSend || busy}
                        onChange={(e) => setLocation(e.target.value)}
                      />
                    </label>
                    <Button disabled={!thread.canSend || busy}>{t('chatPropose')}</Button>
                  </form>
                </>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
type Report = {
  id: string;
  category: string;
  note: string;
  createdAt: string;
  message: {
    body: string;
    hiddenAt: string | null;
    conversation: { vehicle: { make: string; model: string } };
  };
};
export function MessageModeration() {
  const { status, data: session } = useSession(),
    { t } = useLocale();
  const [reports, setReports] = useState<Report[]>([]),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const authenticated = status === 'authenticated';
  const generation = useRef(0);
  const load = useCallback(async () => {
    const rev = ++generation.current;
    const data = await request('?reports=true');
    if (rev === generation.current) setReports(data.reports);
  }, []);
  useEffect(() => {
    setReports([]);
    setError('');
    if (authenticated) void load().catch((e) => setError(e.message));
    return () => {
      generation.current++;
    };
  }, [authenticated, session?.user?.email, load]);
  async function review(id: string, decision: string) {
    setBusy(true);
    setError('');
    try {
      await request('', { action: 'review', id, decision });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'CHAT_FAILED');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="container chat-page">
      <h1>{t('chatModeration')}</h1>
      <p>{t('chatModerationNote')}</p>
      {status === 'loading' ? (
        <p>{t('loading')}</p>
      ) : !authenticated ? (
        <p>{t('chatForbidden')}</p>
      ) : (
        <>
          <Button disabled={busy} onClick={() => void load().catch((e) => setError(e.message))}>
            {t('chatRefresh')}
          </Button>
          {error && <p role="alert">{t(errorKeys[error] ?? 'chatError')}</p>}
          {!reports.length && !error && <p>{t('chatNoReports')}</p>}
          {reports.map((r) => (
            <article className="chat-message" key={r.id}>
              <h2>
                {r.message.conversation.vehicle.make} {r.message.conversation.vehicle.model}
              </h2>
              <p>
                {t(
                  (
                    {
                      SPAM: 'chatSpam',
                      ABUSE: 'chatAbuse',
                      FRAUD: 'chatFraud',
                      PERSONAL_DATA: 'chatPersonal',
                      OTHER: 'chatOtherReason',
                    } as Record<string, MessageKey>
                  )[r.category] ?? 'chatOtherReason',
                )}
              </p>
              <blockquote>{r.message.body}</blockquote>
              <p>{r.note}</p>
              <div className="chat-actions">
                <Button disabled={busy} onClick={() => void review(r.id, 'DISMISSED')}>
                  {t('chatDismiss')}
                </Button>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => void review(r.id, 'HIDDEN')}
                >
                  {t('chatHide')}
                </Button>
              </div>
            </article>
          ))}
        </>
      )}
    </section>
  );
}
