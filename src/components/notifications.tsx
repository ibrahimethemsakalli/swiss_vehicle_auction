'use client';
import Link from 'next/link';
import { Bell, Check, RefreshCw } from 'lucide-react';
import { useSession } from 'next-auth/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale, type MessageKey } from './providers';
import { Button } from './ui/button';

export type NotificationItem = {
  id: string;
  kind: string;
  vehicleId: string;
  vehicleName: string;
  createdAt: string;
  readAt: string | null;
  retentionRequestId?: string | null;
  supportTicketId?: string | null;
};
type Inbox = { items: NotificationItem[]; unreadCount: number; nextCursor: string | null };
const messageKeys: Record<string, MessageKey> = {
  REFUND_UPDATE: 'rfNoticeUpdate',
  SUPPORT_REPLY: 'srNoticeReply',
  SUPPORT_ACTIVITY: 'srNoticeActivity',
  SUPPORT_ASSIGNMENT: 'srNoticeAssignment',
  RETENTION_REVIEW: 'rhNoticeReview',
  RETENTION_INFO: 'rhNoticeInfo',
  RETENTION_KEPT: 'rhNoticeKept',
  RETENTION_RELEASED: 'rhNoticeReleased',
  RETENTION_WITHDRAWN: 'rhNoticeWithdrawn',
  TRUST_UPDATE: 'trustNotice',
  SEARCH_MATCH: 'noticeSearchMatch',
  OUTBID: 'noticeOutbid',
  AUCTION_WON: 'noticeWon',
  AUCTION_CLOSED: 'noticeClosed',
  LISTING_APPROVED: 'noticeApproved',
  LISTING_REJECTED: 'noticeRejected',
  HOLD_RENEWAL: 'noticeRenewal',
  DISPUTE_NO_ACTION: 'noticeDisputeNoAction',
  DISPUTE_MANUAL: 'noticeDisputeManual',
  DISPUTE_REFUND_REQUIRED: 'noticeDisputeRefund',
  OFFER_ACCEPTED: 'noticeOfferAccepted',
  CHAT_MESSAGE: 'noticeChatMessage',
  CHAT_APPOINTMENT: 'noticeChatAppointment',
  CHAT_REMINDER: 'noticeChatReminder',
};
function changed() {
  window.dispatchEvent(new Event('notifications-changed'));
}
export function NotificationBell() {
  const { status, data: session } = useSession();
  const { t } = useLocale();
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    setCount(null);
    if (status !== 'authenticated') return;
    const controller = new AbortController();
    let revision = 0;
    const refresh = async () => {
      if (document.hidden) return;
      const current = ++revision;
      try {
        const response = await fetch('/api/notifications?summary=true', {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok) throw new Error();
        const body = await response.json();
        if (current === revision && !controller.signal.aborted) setCount(body.unreadCount);
      } catch {
        if (!controller.signal.aborted && current === revision) setCount(null);
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 45000);
    window.addEventListener('notifications-changed', refresh);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      controller.abort();
      clearInterval(timer);
      window.removeEventListener('notifications-changed', refresh);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [status, session?.user?.email]);
  if (status !== 'authenticated') return null;
  return (
    <Link
      href="/notifications"
      className="notification-bell"
      aria-label={
        count === null ? t('notificationsTitle') : t('notificationsUnreadCount', { count })
      }
    >
      <Bell size={20} aria-hidden="true" />
      {count !== null && count > 0 && <span aria-hidden="true">{count > 99 ? '99+' : count}</span>}
    </Link>
  );
}

export function NotificationList({
  data,
  busy,
  onRead,
}: {
  data: Inbox;
  busy: boolean;
  onRead: (id: string) => void;
}) {
  const { t, locale } = useLocale();
  return (
    <ul className="notification-list">
      {data.items.map((item) => (
        <li
          key={item.id}
          className={item.readAt ? 'notification-card' : 'notification-card unread'}
        >
          <div className="notification-meta">
            <span>{t(item.readAt ? 'notificationsRead' : 'notificationsUnread')}</span>
            <time dateTime={item.createdAt}>
              {new Intl.DateTimeFormat(`${locale}-CH`, {
                dateStyle: 'medium',
                timeStyle: 'short',
                timeZone: 'Europe/Zurich',
              }).format(new Date(item.createdAt))}
            </time>
          </div>
          <h2>
            {item.kind.startsWith('SUPPORT_')
              ? t('spTitle')
              : item.kind.startsWith('RETENTION_')
                ? t('rhQueue')
                : item.vehicleName}
          </h2>
          <p>{t(messageKeys[item.kind] ?? 'noticeGeneric')}</p>
          <div className="notification-actions">
            <Link
              href={
                item.kind === 'REFUND_UPDATE'
                  ? '/refunds'
                  : item.kind.startsWith('SUPPORT_') &&
                      item.supportTicketId &&
                      /^[\da-f-]{36}$/i.test(item.supportTicketId)
                    ? `${item.kind === 'SUPPORT_REPLY' ? '/support' : '/admin/support'}?ticket=${encodeURIComponent(item.supportTicketId)}`
                    : item.kind.startsWith('RETENTION_') &&
                        item.retentionRequestId &&
                        /^[\da-f-]{36}$/i.test(item.retentionRequestId)
                      ? `/admin/retention?request=${encodeURIComponent(item.retentionRequestId)}`
                      : item.kind === 'TRUST_UPDATE'
                        ? '/trust'
                        : item.kind === 'LISTING_REJECTED'
                          ? '/drafts'
                          : item.kind.startsWith('CHAT_')
                            ? '/messages'
                            : [
                                  'SEARCH_MATCH',
                                  'OUTBID',
                                  'AUCTION_WON',
                                  'AUCTION_CLOSED',
                                  'LISTING_APPROVED',
                                ].includes(item.kind) && /^[\da-f-]{36}$/i.test(item.vehicleId)
                              ? `/vehicles/${item.vehicleId}`
                              : '/dashboard'
              }
            >
              {t('notificationsDetails')}
            </Link>
            {!item.readAt && (
              <Button variant="outline" disabled={busy} onClick={() => onRead(item.id)}>
                <Check size={16} aria-hidden="true" />
                {t('notificationsMarkRead')}
              </Button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
export function NotificationInbox() {
  const { status, data: session } = useSession();
  const { t } = useLocale();
  const [data, setData] = useState<Inbox | null>(null);
  const [unread, setUnread] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const revision = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const refresh = useCallback(
    async (cursor?: string) => {
      controller.current?.abort();
      const request = new AbortController();
      controller.current = request;
      const current = ++revision.current;
      setBusy(true);
      setError(false);
      try {
        const response = await fetch(
          `/api/notifications?unread=${unread}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
          { cache: 'no-store', signal: request.signal },
        );
        if (!response.ok) throw new Error();
        const next: Inbox = await response.json();
        if (current === revision.current)
          setData((old) => ({
            ...next,
            items:
              cursor && old
                ? [
                    ...old.items,
                    ...next.items.filter(
                      (item) => !old.items.some((existing) => existing.id === item.id),
                    ),
                  ]
                : next.items,
          }));
      } catch {
        if (!request.signal.aborted && current === revision.current) setError(true);
      } finally {
        if (!request.signal.aborted && current === revision.current) setBusy(false);
      }
    },
    [unread],
  );
  useEffect(() => {
    setData(null);
    setError(false);
    if (status === 'authenticated') void refresh();
    return () => {
      controller.current?.abort();
      revision.current++;
    };
  }, [status, session?.user?.email, refresh]);
  async function markRead(id: string) {
    const requestVersion = revision.current;
    setBusy(true);
    setError(false);
    try {
      const response = await fetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (!response.ok) throw new Error();
      changed();
      if (requestVersion === revision.current) await refresh();
    } catch {
      if (requestVersion === revision.current) {
        setError(true);
        setBusy(false);
      }
    }
  }
  return (
    <section className="container notifications-page">
      <div className="notifications-heading">
        <div>
          <h1>{t('notificationsTitle')}</h1>
          <p>{t('notificationsIntro')}</p>
        </div>
        <Bell size={30} aria-hidden="true" />
      </div>
      {status === 'loading' ? (
        <p role="status">{t('loading')}</p>
      ) : status !== 'authenticated' ? (
        <p>
          <Link href="/login?next=/notifications">{t('signInRequired')}</Link>
        </p>
      ) : (
        <>
          <div className="notifications-toolbar">
            <label>
              <input
                type="checkbox"
                checked={unread}
                onChange={(event) => setUnread(event.target.checked)}
              />
              {t('notificationsOnlyUnread')}
            </label>
            <Button variant="outline" disabled={busy} onClick={() => void refresh()}>
              <RefreshCw size={16} aria-hidden="true" />
              {t('notificationsRefresh')}
            </Button>
          </div>
          <p aria-live="polite">
            {data && t('notificationsUnreadCount', { count: data.unreadCount })}
          </p>
          {error && <p role="alert">{t('notificationsError')}</p>}
          {busy && <p role="status">{t('loading')}</p>}
          {data && <NotificationList data={data} busy={busy} onRead={(id) => void markRead(id)} />}
          {data && !data.items.length && !busy && !error && (
            <p className="notification-empty">
              {t(unread ? 'notificationsEmptyUnread' : 'notificationsEmpty')}
            </p>
          )}
          {data?.nextCursor && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void refresh(data.nextCursor!)}
            >
              {t('notificationsMore')}
            </Button>
          )}
        </>
      )}
    </section>
  );
}
