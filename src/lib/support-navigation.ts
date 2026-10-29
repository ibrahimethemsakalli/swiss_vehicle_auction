// URL state carries display preferences only; API authorization remains authoritative.
import { validSupportMessageId } from './support-message-link';
export type SupportNavigation = {
  ticket: string;
  message?: string;
  page: number;
  messagePage: number;
  status: string;
  assignment: 'all' | 'mine' | 'unassigned';
  unread: boolean;
  q: string;
};
export function readSupportNavigation(params: URLSearchParams, admin: boolean): SupportNavigation {
  const one = (key: string) => (params.getAll(key).length === 1 ? params.get(key)! : '');
  const page = (key: string) =>
    /^[1-9]\d{0,4}$/.test(one(key)) && Number(one(key)) <= 10000 ? Number(one(key)) : 1;
  const ticket = one('ticket');
  return {
    ...(validSupportMessageId(ticket) && validSupportMessageId(one('message'))
      ? { message: one('message').toLowerCase() }
      : {}),
    ticket: /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(ticket)
      ? ticket.toLowerCase()
      : '',
    page: page('page'),
    messagePage: page('messagePage'),
    status: ['OPEN', 'WAITING_USER', 'RESOLVED', 'CLOSED'].includes(one('status'))
      ? one('status')
      : '',
    assignment:
      admin && ['mine', 'unassigned'].includes(one('assignment'))
        ? (one('assignment') as 'mine' | 'unassigned')
        : 'all',
    unread: one('unread') === 'true',
    q: one('q').trim().slice(0, 160),
  };
}
export function supportNavigationHref(state: SupportNavigation, admin: boolean, locale?: string) {
  const p = new URLSearchParams();
  if (state.ticket) p.set('ticket', state.ticket);
  if (state.ticket && state.message && validSupportMessageId(state.message))
    p.set('message', state.message);
  if (state.page > 1) p.set('page', String(state.page));
  if (state.ticket && state.messagePage > 1) p.set('messagePage', String(state.messagePage));
  if (state.status) p.set('status', state.status);
  if (admin && state.assignment !== 'all') p.set('assignment', state.assignment);
  if (state.unread) p.set('unread', 'true');
  if (state.q) p.set('q', state.q);
  if (locale && ['de', 'fr', 'it', 'en'].includes(locale)) p.set('lang', locale);
  return (admin ? '/admin/support' : '/support') + (p.size ? '?' + p.toString() : '');
}
