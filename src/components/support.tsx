'use client';
import { useEffect, useState, useRef } from 'react';
import { hasSupportDraft, installSupportDraftGuard } from '../lib/support-draft-guard';
import {
  canReviewSupportConflict,
  loadedSupportConflict,
  type SupportConflict,
} from '../lib/support-conflict';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import {
  readSupportNavigation,
  supportNavigationHref,
  type SupportNavigation,
} from '../lib/support-navigation';
import { useRouter, useSearchParams } from 'next/navigation';
import { useLocale, type MessageKey } from './providers';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { SupportHistory } from './support-history';
import { Select, Textarea } from './ui/form-controls';
type Ticket = {
  id: string;
  subject: string;
  status: string;
  version: number;
  userId: string;
  updatedAt: string;
  ownerId: string | null;
  unreadCount?: number;
};
type Entry = {
  unread: boolean;
  id: string;
  body: string;
  staff: boolean;
  status: string;
  createdAt: string;
};
const states = ['OPEN', 'WAITING_USER', 'RESOLVED', 'CLOSED'];
export function Support({ admin = false }: { admin?: boolean }) {
  const params = useSearchParams();
  const router = useRouter();
  const nav = readSupportNavigation(new URLSearchParams(params.toString()), admin);
  const locale = params.getAll('lang').length === 1 ? (params.get('lang') ?? undefined) : undefined;
  const href = supportNavigationHref(nav, admin, locale);
  const change = (patch: Partial<SupportNavigation>) => {
    const next = supportNavigationHref({ ...nav, ...patch }, admin, locale);
    if (next !== href) router.push(next, { scroll: false });
  };
  return (
    <SupportView
      key={JSON.stringify(nav) + admin}
      admin={admin}
      nav={nav}
      change={change}
      href={href}
    />
  );
}
function SupportView({
  admin,
  nav,
  change: navigate,
  href,
}: {
  admin: boolean;
  nav: SupportNavigation;
  change: (patch: Partial<SupportNavigation>) => void;
  href: string;
}) {
  const { t, date } = useLocale();
  const { status: auth, data: session } = useSession();
  const [items, setItems] = useState<Ticket[]>([]),
    [ticket, setTicket] = useState<Ticket | null>(null),
    [entries, setEntries] = useState<Entry[]>([]);
  const id = nav.ticket,
    page = id ? nav.messagePage : nav.page,
    filter = nav.status,
    assignment = nav.assignment,
    unreadOnly = nav.unread,
    search = nav.q;
  const [more, setMore] = useState(false),
    [version, setVersion] = useState(0),
    [searchDraft, setSearchDraft] = useState(search),
    [loading, setLoading] = useState(false);
  const [subject, setSubject] = useState(''),
    [body, setBody] = useState(''),
    [state, setState] = useState('OPEN'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [admins, setAdmins] = useState<{ id: string; email: string }[]>([]),
    [owner, setOwner] = useState(''),
    [reason, setReason] = useState(''),
    [unreadCount, setUnreadCount] = useState(0);
  const [assignments, setAssignments] = useState<
    {
      id: string;
      actorId: string;
      ownerId: string | null;
      previousOwnerId: string | null;
      reason: string;
      createdAt: string;
    }[]
  >([]);
  const routingPending = useRef<{ payload: string; commandId: string } | null>(null);
  const [conflict, setConflict] = useState<SupportConflict>(null);
  const conflictRef = useRef(conflict);
  conflictRef.current = conflict;
  const [recentView, setRecentView] = useState(false);
  const [historyPage, setHistoryPage] = useState<number | null>(nav.message ? 1 : null);
  const pending = useRef<{ payload: string; commandId: string } | null>(null);
  const label = (s: string) => t(('sp' + s) as MessageKey);
  const draft = useRef({ subject, body, reason, warning: t('spUnsavedLeave') });
  draft.current = { subject, body, reason, warning: t('spUnsavedLeave') };
  const [departure, setDeparture] = useState<{ proceed: () => void } | null>(null);
  const guard = useRef<ReturnType<typeof installSupportDraftGuard> | null>(null);
  useEffect(() => {
    guard.current = installSupportDraftGuard(
      window,
      () => hasSupportDraft(draft.current.subject, draft.current.body, draft.current.reason),
      (proceed) => setDeparture({ proceed }),
    );
    return () => {
      guard.current?.dispose();
      guard.current = null;
    };
  }, []);
  const change = (patch: Partial<SupportNavigation>) => {
    return (
      guard.current?.allow(() => {
        setBody('');
        setSubject('');
        setReason('');
        navigate(patch);
      }) ?? false
    );
  };
  useEffect(() => {
    if (auth !== 'authenticated') return;
    const abort = new AbortController();
    setError('');
    setLoading(true);
    setMore(false);
    if (!id) {
      setTicket(null);
      setEntries([]);
    }
    setItems([]);
    const q = new URLSearchParams({
      admin: String(admin),
      page: String(page),
      ...(id
        ? { id, ...(conflictRef.current ? { newest: 'true' } : {}) }
        : {
            assignment,
            unread: String(unreadOnly),
            q: search,
            ...(filter ? { status: filter } : {}),
          }),
    });
    fetch('/api/support?' + q, { cache: 'no-store', signal: abort.signal })
      .then(async (r) => {
        if (!r.ok) throw Error();
        return r.json();
      })
      .then((d) => {
        if (abort.signal.aborted) return;
        setItems(d.items ?? []);
        setTicket(d.ticket ?? null);
        setEntries(d.entries ?? []);
        setMore(conflictRef.current ? false : d.more);
        setRecentView(Boolean(conflictRef.current));
        setAdmins(d.admins ?? []);
        setAssignments(d.assignments ?? []);
        setUnreadCount(d.unreadCount ?? 0);
        if (!draft.current.reason && !conflictRef.current) setOwner(d.ticket?.ownerId ?? '');
        if (d.ticket && !draft.current.body && !conflictRef.current) setState(d.ticket.status);
        if (d.ticket) setConflict((current) => loadedSupportConflict(current, d.ticket.version));
        setLoading(false);
      })
      .catch(() => {
        if (!abort.signal.aborted) {
          setConflict((current) => (current ? { ...current, loadedVersion: null } : null));
          setError(t('spFailed'));
          setLoading(false);
        }
      });
    return () => abort.abort();
  }, [
    auth,
    session?.user?.email,
    admin,
    id,
    page,
    filter,
    assignment,
    unreadOnly,
    search,
    version,
    t,
  ]);
  const staff = admin && ticket?.userId !== (session?.user as { id?: string })?.id;
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || loading || conflict || (id && !ticket)) return;
    setBusy(true);
    setError('');
    try {
      const command = ticket
        ? {
            action: 'reply',
            id: ticket.id,
            version: ticket.version,
            body,
            ...(staff ? { status: state } : {}),
          }
        : { action: 'create', subject, body };
      const payload = JSON.stringify(command);
      if (pending.current?.payload !== payload)
        pending.current = { payload, commandId: crypto.randomUUID() };
      const r = await fetch('/api/support', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...command, commandId: pending.current.commandId }),
      });
      if (!r.ok) {
        const d = await r.json();
        if (d.error === 'CONFLICT' && ticket)
          setConflict({ previousVersion: ticket.version, loadedVersion: null });
        throw Error(
          d.error === 'CONFLICT'
            ? t('spConflict')
            : d.error === 'LIMIT' || d.error === 'RATE_LIMITED'
              ? t('spLimit')
              : t('spFailed'),
        );
      }
      const d = await r.json();
      pending.current = null;
      draft.current.body = '';
      draft.current.subject = '';
      // Do not discard an independent assignment draft when saving a reply.
      if (!draft.current.reason) navigate({ ticket: d.id, messagePage: 1 });
      setBody('');
      setSubject('');
      setVersion((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('spFailed'));
    } finally {
      setBusy(false);
    }
  }
  async function routing(action: 'assign' | 'read') {
    if (!ticket || busy || loading || (action === 'assign' && conflict)) return;
    setBusy(true);
    setError('');
    try {
      let command: Record<string, unknown>;
      if (action === 'read')
        command = {
          action,
          id: ticket.id,
          entryIds: entries.filter((e) => e.unread).map((e) => e.id),
        };
      else {
        const base = {
          action,
          id: ticket.id,
          version: ticket.version,
          ownerId: owner || null,
          reason,
        };
        const payload = JSON.stringify(base);
        if (routingPending.current?.payload !== payload)
          routingPending.current = { payload, commandId: crypto.randomUUID() };
        command = { ...base, commandId: routingPending.current.commandId };
      }
      const response = await fetch('/api/support', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(command),
      });
      if (!response.ok) {
        const d = await response.json();
        if (d.error === 'CONFLICT')
          setConflict({ previousVersion: ticket.version, loadedVersion: null });
        throw Error(d.error === 'CONFLICT' ? t('spConflict') : t('spFailed'));
      }
      routingPending.current = null;
      if (action === 'assign') {
        setReason('');
        draft.current.reason = '';
      }
      setVersion((v) => v + 1);
      window.dispatchEvent(new Event('notifications-changed'));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('spFailed'));
    } finally {
      setBusy(false);
    }
  }
  if (auth === 'loading') return <p>{t('loading')}</p>;
  if (auth !== 'authenticated')
    return <Link href={'/login?next=' + encodeURIComponent(href)}>{t('login')}</Link>;
  return (
    <section
      className="container support-page"
      style={{ paddingBlock: 32, maxWidth: 900, overflowWrap: 'anywhere' }}
    >
      <Dialog
        open={Boolean(departure)}
        onOpenChange={(open) => {
          if (!open) setDeparture(null);
        }}
      >
        <DialogContent>
          <DialogTitle className="pr-8">{t('spUnsavedTitle')}</DialogTitle>
          <DialogDescription className="my-4">{t('spUnsavedLeave')}</DialogDescription>
          <div className="flex flex-wrap gap-3">
            <Button onClick={() => setDeparture(null)}>{t('spStay')}</Button>
            <Button
              onClick={() => {
                const action = departure?.proceed;
                setDeparture(null);
                action?.();
              }}
            >
              {t('spDiscardLeave')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <h1>{t(admin ? 'spAdmin' : 'spTitle')}</h1>
      {id && historyPage !== null && (
        <SupportHistory
          id={id}
          admin={admin}
          start={historyPage}
          startContext={nav.message}
          onClose={() => setHistoryPage(null)}
        />
      )}
      <p>{t('spIntro')}</p>
      {error && <p role="alert">{error}</p>}
      {conflict && (
        <aside
          className="border border-amber-500 rounded-xl p-4 my-4 space-y-3"
          aria-label={t('scTitle')}
        >
          <h2>{t('scTitle')}</h2>
          <p>{t('scPreserved')}</p>
          <p>
            {t('scVersions', {
              previous: conflict.previousVersion,
              current: conflict.loadedVersion ?? '—',
            })}
          </p>
          <div className="flex flex-wrap gap-3">
            <Button
              disabled={loading || busy}
              onClick={() => {
                setConflict((c) => (c ? { ...c, loadedVersion: null } : null));
                setVersion((v) => v + 1);
              }}
            >
              {t('scLoad')}
            </Button>
            <Button
              disabled={!canReviewSupportConflict(conflict, ticket?.version, loading) || busy}
              onClick={() => {
                if (!canReviewSupportConflict(conflict, ticket?.version, loading)) return;
                pending.current = null;
                routingPending.current = null;
                setConflict(null);
                setError('');
              }}
            >
              {t('scReviewed')}
            </Button>
          </div>
          <p>{t('scNoAutoSend')}</p>
        </aside>
      )}
      <div className="flex flex-wrap gap-3 my-4">
        <Button
          onClick={() => {
            if (!change({ ticket: '', messagePage: 1 })) return;
            setSubject('');
            setReason('');
            setBody('');
            setVersion((v) => v + 1);
          }}
        >
          {t(admin ? 'spAdmin' : 'spList')}
        </Button>
        <Button disabled={loading || busy} onClick={() => setVersion((v) => v + 1)}>
          {t('spRefresh')}
        </Button>
      </div>
      {!id && (
        <>
          <form
            className="border rounded-xl p-4 space-y-3 my-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (!change({ q: searchDraft.trim(), page: 1 })) return;
              setVersion((v) => v + 1);
            }}
          >
            <label>
              {t('sqSearch')}
              <Input
                maxLength={160}
                value={searchDraft}
                onChange={(e) => setSearchDraft(e.target.value)}
              />
            </label>
            <p>{t('sqHint')}</p>
            {admin && (
              <label>
                {t('sqAssignment')}
                <Select
                  value={assignment}
                  onChange={(e) => {
                    change({
                      assignment: e.target.value as SupportNavigation['assignment'],
                      page: 1,
                    });
                  }}
                >
                  <option value="all">{t('sqAll')}</option>
                  <option value="mine">{t('sqMine')}</option>
                  <option value="unassigned">{t('srUnassigned')}</option>
                </Select>
              </label>
            )}
            <label style={{ flexDirection: 'row', alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={unreadOnly}
                onChange={(e) => {
                  change({ unread: e.target.checked, page: 1 });
                }}
              />
              {t('sqUnread')}
            </label>
            <div className="flex flex-wrap gap-3">
              <Button type="submit">{t('sqApply')}</Button>
              <Button
                type="button"
                onClick={() => {
                  if (!change({ status: '', assignment: 'all', unread: false, q: '', page: 1 }))
                    return;
                  setSearchDraft('');
                  setVersion((v) => v + 1);
                }}
              >
                {t('sqClear')}
              </Button>
            </div>
          </form>
          <label>
            {t('spStatus')}
            <Select
              value={filter}
              onChange={(e) => {
                change({ status: e.target.value, page: 1 });
              }}
            >
              <option value="">{t('spAll')}</option>
              {states.map((s) => (
                <option key={s} value={s}>
                  {label(s)}
                </option>
              ))}
            </Select>
          </label>
          <ul className="space-y-3 my-4">
            {items.map((i) => (
              <li className="border rounded-xl p-4" key={i.id}>
                <button
                  className="text-left underline"
                  onClick={() => {
                    if (!change({ ticket: i.id, messagePage: 1 })) return;
                    setBody('');
                  }}
                >
                  {i.subject}
                </button>
                <p>
                  {t('sqId')}: {i.id}
                </p>
                <p>
                  {label(i.status)} · {date(i.updatedAt)} ·{' '}
                  {t('srUnread', { count: i.unreadCount ?? 0 })}
                </p>
              </li>
            ))}
          </ul>
          {loading ? (
            <p role="status">{t('loading')}</p>
          ) : (
            !error && !items.length && <p role="status">{t('sqEmpty')}</p>
          )}
        </>
      )}
      {ticket && (
        <>
          <h2>{ticket.subject}</h2>
          <p>
            {t('sqId')}: {ticket.id}
          </p>
          <p>
            {label(ticket.status)} · {t('srUnread', { count: unreadCount })}
          </p>
          <p>
            {t('srOwner')}:{' '}
            {ticket.ownerId
              ? admin
                ? (admins.find((a) => a.id === ticket.ownerId)?.email ?? t('srUnavailable'))
                : t('srAssigned')
              : t('srUnassigned')}
          </p>
          {entries.some((e) => e.unread) && (
            <Button disabled={busy} onClick={() => void routing('read')}>
              {t('srReadPage')}
            </Button>
          )}
          {staff && (
            <>
              <p>{t('srAssignmentHint')}</p>
              {(ticket.status !== 'CLOSED' || reason) && (
                <form
                  className="border rounded-xl p-4 space-y-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void routing('assign');
                  }}
                >
                  <label>
                    {t('srOwner')}
                    <Select value={owner} onChange={(e) => setOwner(e.target.value)}>
                      <option value="">{t('srUnassigned')}</option>
                      {ticket.ownerId && !admins.some((a) => a.id === ticket.ownerId) && (
                        <option value={ticket.ownerId} disabled>
                          {t('srUnavailable')}
                        </option>
                      )}
                      {admins.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.email}
                        </option>
                      ))}
                    </Select>
                  </label>
                  <label>
                    {t('srReason')}
                    <Textarea
                      minLength={5}
                      maxLength={500}
                      required
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                    />
                  </label>
                  <Button
                    disabled={
                      busy ||
                      loading ||
                      Boolean(conflict) ||
                      ticket.status === 'CLOSED' ||
                      owner === (ticket.ownerId ?? '')
                    }
                    type="submit"
                  >
                    {t('srSave')}
                  </Button>
                </form>
              )}
              <details>
                <summary>{t('srHistory')}</summary>
                <ul>
                  {assignments.map((a) => (
                    <li key={a.id} className="border rounded p-3">
                      {date(a.createdAt)} · {a.actorId}
                      <p>
                        {a.previousOwnerId ?? t('srUnassigned')} → {a.ownerId ?? t('srUnassigned')}
                      </p>
                      <p>{a.reason}</p>
                    </li>
                  ))}
                </ul>
                <p>{t('srRecent')}</p>
              </details>
            </>
          )}
          <Button onClick={() => setHistoryPage(recentView ? 0 : page)}>{t('shTitle')}</Button>
          {recentView && <p role="status">{t('scRecent')}</p>}
          <ol className="space-y-3 my-4">
            {entries.map((e) => (
              <li className="border rounded-xl p-4" key={e.id}>
                <strong>{t(e.staff ? 'spStaff' : 'spUser')}</strong> · {date(e.createdAt)} ·{' '}
                {label(e.status)} {e.unread && <strong> · {t('srNew')}</strong>}
                <p className="whitespace-pre-wrap">{e.body}</p>
              </li>
            ))}
          </ol>
        </>
      )}
      <div className="flex gap-3 my-4">
        <Button
          disabled={page === 1 || recentView || loading}
          onClick={() => (id ? setHistoryPage(page - 1) : change({ page: page - 1 }))}
        >
          {t('spPrevious')}
        </Button>
        <span>{page}</span>
        <Button
          disabled={!more || loading}
          onClick={() => (id ? setHistoryPage(page + 1) : change({ page: page + 1 }))}
        >
          {t('spNext')}
        </Button>
      </div>
      {((!id && !admin) || (ticket && (ticket.status !== 'CLOSED' || staff || body))) && (
        <form onSubmit={submit} className="space-y-4 border rounded-xl p-4">
          {!ticket && (
            <label className="block">
              {t('spSubject')}
              <Input
                required
                minLength={5}
                maxLength={160}
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              />
            </label>
          )}
          <label className="block">
            {t('spBody')}
            <Textarea
              required
              minLength={10}
              maxLength={4000}
              rows={6}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </label>
          {ticket && staff && (
            <label className="block">
              {t('spStatus')}
              <Select value={state} onChange={(e) => setState(e.target.value)}>
                {states.map((s) => (
                  <option key={s} value={s}>
                    {label(s)}
                  </option>
                ))}
              </Select>
            </label>
          )}
          <Button
            disabled={
              busy || loading || Boolean(conflict) || (ticket?.status === 'CLOSED' && !staff)
            }
            type="submit"
          >
            {t(ticket ? 'spReply' : 'spCreate')}
          </Button>
        </form>
      )}
      {ticket?.status === 'CLOSED' && !staff && <p>{t('spClosedHint')}</p>}
    </section>
  );
}
