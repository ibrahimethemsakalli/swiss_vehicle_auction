'use client';
import { useSession } from 'next-auth/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { guestFavorites, favoriteLimit } from '../lib/favorite-rules';
const storageKey = 'autoveri-saved';
type Snapshot = { key: string; ids: string[]; unavailable: string[] };
export function useFavorites() {
  const { data: session, status } = useSession();
  const identity =
    status === 'authenticated'
      ? ((session?.user as { id?: string } | undefined)?.id ?? 'loading')
      : status === 'unauthenticated'
        ? 'guest'
        : 'loading';
  const active = useRef(identity);
  active.current = identity;
  const epoch = useRef(0),
    writing = useRef(false);
  const [snapshot, setSnapshot] = useState<Snapshot>({ key: '', ids: [], unavailable: [] });
  const [guests, setGuests] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [merged, setMerged] = useState<number | null>(null);
  const refresh = useCallback(async () => {
    if (identity === 'loading' || writing.current) return;
    if (identity === 'guest') {
      try {
        setSnapshot({
          key: identity,
          ids: guestFavorites(localStorage.getItem(storageKey)),
          unavailable: [],
        });
        setError('');
      } catch {
        setError('favoriteFailed');
      }
      return;
    }
    const ticket = ++epoch.current;
    try {
      const r = await fetch('/api/favorites', { cache: 'no-store' });
      if (!r.ok) throw Error();
      const data = await r.json();
      if (active.current === identity && ticket === epoch.current) {
        setSnapshot({ key: identity, ids: data.ids, unavailable: data.unavailable });
        setError('');
      }
    } catch {
      if (active.current === identity && ticket === epoch.current) setError('favoriteFailed');
    }
  }, [identity]);
  useEffect(() => {
    epoch.current++;
    writing.current = false;
    setBusy(false);
    setError('');
    setMerged(null);
    try {
      setGuests(guestFavorites(localStorage.getItem(storageKey)));
    } catch {
      setGuests([]);
    }
    void refresh();
    const sync = () => {
      try {
        setGuests(guestFavorites(localStorage.getItem(storageKey)));
      } catch {}
      void refresh();
    };
    const timer = setInterval(() => void refresh(), 30000);
    window.addEventListener('focus', sync);
    window.addEventListener('storage', sync);
    return () => {
      epoch.current++;
      clearInterval(timer);
      window.removeEventListener('focus', sync);
      window.removeEventListener('storage', sync);
    };
  }, [identity, refresh]);
  const ids = snapshot.key === identity ? snapshot.ids : [];
  const unavailable = snapshot.key === identity ? snapshot.unavailable : [];
  async function mutate(body: unknown, imported?: string[]) {
    if (writing.current || identity === 'loading' || snapshot.key !== identity) return;
    writing.current = true;
    setBusy(true);
    setError('');
    const ticket = ++epoch.current;
    try {
      const r = await fetch('/api/favorites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error === 'FAVORITE_LIMIT' ? 'favoriteLimit' : 'favoriteFailed');
      if (active.current !== identity || ticket !== epoch.current) return;
      setSnapshot({ key: identity, ids: d.ids, unavailable: d.unavailable });
      if (imported) {
        // Remove only the explicitly submitted guest snapshot; retain newer additions in another tab.
        const remaining = guestFavorites(localStorage.getItem(storageKey)).filter(
          (id) => !imported.includes(id),
        );
        localStorage.setItem(storageKey, JSON.stringify(remaining));
        setGuests(remaining);
        setMerged(d.skipped);
      }
    } catch (e) {
      if (active.current === identity && ticket === epoch.current)
        setError(e instanceof Error ? e.message : 'favoriteFailed');
    } finally {
      if (active.current === identity && ticket === epoch.current) {
        writing.current = false;
        setBusy(false);
      }
    }
  }
  function toggle(id: string) {
    if (identity === 'guest') {
      let current: string[];
      try {
        current = guestFavorites(localStorage.getItem(storageKey));
      } catch {
        setError('favoriteFailed');
        return;
      }
      const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
      if (next.length > favoriteLimit) {
        setError('favoriteLimit');
        return;
      }
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
        setSnapshot({ key: identity, ids: next, unavailable: [] });
        setGuests(next);
        setError('');
      } catch {
        setError('favoriteFailed');
      }
    } else void mutate({ action: 'set', vehicleId: id, saved: !ids.includes(id) });
  }
  return {
    ids,
    unavailable,
    guests,
    busy: busy || identity === 'loading' || snapshot.key !== identity,
    error,
    merged,
    account: identity !== 'guest' && identity !== 'loading',
    toggle,
    refresh,
    merge: () => void mutate({ action: 'merge', ids: guests }, guests),
  };
}
