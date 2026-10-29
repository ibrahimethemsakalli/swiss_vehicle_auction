'use client';
import { useSession } from 'next-auth/react';
import { useEffect, useRef, useState } from 'react';
import type { Filters } from '../lib/market-types';
import { useLocale, type MessageKey } from './providers';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { savedSearchCommand } from '../lib/search-state';
type Item = { id: string; name: string; filters: Filters; alerts: boolean };

export function SavedSearches({
  filters,
  apply,
}: {
  filters: Filters;
  apply: (filters: Filters) => void;
}) {
  const { data: session, status } = useSession();
  const identity = (session?.user as { id?: string } | undefined)?.id ?? '';
  const active = useRef(identity);
  const requestVersion = useRef(0);
  active.current = identity;
  const { t } = useLocale();
  const [snapshot, setSnapshot] = useState<{ owner: string; items: Item[] }>({
    owner: '',
    items: [],
  });
  const [name, setName] = useState(''),
    [alerts, setAlerts] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<MessageKey | null>(null);
  const [link, setLink] = useState('');
  useEffect(() => {
    setLink('');
  }, [filters]);
  const items = snapshot.owner === identity ? snapshot.items : [];
  useEffect(() => {
    const version = ++requestVersion.current;
    setError(null);
    setBusy(false);
    setName('');
    setAlerts(false);
    if (!identity) return;
    const controller = new AbortController();
    fetch('/api/saved-searches', { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw Error();
        return response.json();
      })
      .then((data) => {
        if (!controller.signal.aborted && version === requestVersion.current)
          setSnapshot({ owner: identity, items: data.items });
      })
      .catch(() => {
        if (!controller.signal.aborted && version === requestVersion.current) setError('searchFailed');
      });
    return () => controller.abort();
  }, [identity]);
  async function mutate(command: unknown) {
    if (busy || !identity) return;
    if (!savedSearchCommand.safeParse(command).success) {
      setError('searchNameRequired');
      return;
    }
    const owner = identity;
    ++requestVersion.current;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/saved-searches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(command),
      });
      const result = await response.json();
      if (active.current !== owner) return;
      if (!response.ok) {
        setError(
          result.error === 'SEARCH_LIMIT'
            ? 'searchLimit'
            : result.error === 'SEARCH_NAME'
              ? 'searchDuplicate'
              : 'searchFailed',
        );
        return;
      }
      setSnapshot({ owner, items: result.items });
      setName('');
    } catch {
      if (active.current === owner) setError('searchFailed');
    } finally {
      if (active.current === owner) setBusy(false);
    }
  }
  return (
    <details className="panel saved-searches">
      <summary>{t('searchSavedTitle')}</summary>
      <div className="saved-search-content">
        <Button variant="outline" onClick={() => setLink(window.location.href)}>
          {t('searchShare')}
        </Button>
        {link && (
          <label>
            {t('searchLink')}
            <Input readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
          </label>
        )}
        {status !== 'authenticated' ? (
          <p>{t('searchLogin')}</p>
        ) : (
          <>
            <p className="fine-print">{t('searchScope')}</p>
            <label>
              {t('searchName')}
              <Input
                value={name}
                maxLength={60}
                aria-invalid={error === 'searchNameRequired'}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label className="check-row">
              <input
                type="checkbox"
                checked={alerts}
                onChange={(e) => setAlerts(e.target.checked)}
              />
              {t('searchAlerts')}
            </label>
            <Button
              disabled={busy}
              onClick={() => void mutate({ action: 'save', name, filters, alerts })}
            >
              {t('searchSave')}
            </Button>
            {items.length === 0 && <p>{t('searchEmpty')}</p>}
            <ul className="saved-search-list">
              {items.map((item) => (
                <li key={item.id}>
                  <div>
                    <strong>{item.name}</strong>
                    <p className="fine-print">
                      {t(item.alerts ? 'searchAlertsOn' : 'searchAlertsOff')}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    onClick={() => {
                      apply(item.filters);
                      setLink('');
                    }}
                  >
                    {t('searchApply')}
                  </Button>
                  <Button
                    variant="outline"
                    disabled={busy}
                    aria-label={`${t('searchDelete')}: ${item.name}`}
                    onClick={() => void mutate({ action: 'delete', id: item.id })}
                  >
                    {t('searchDelete')}
                  </Button>
                </li>
              ))}
            </ul>
          </>
        )}
        {error && <p role="alert">{t(error)}</p>}
      </div>
    </details>
  );
}
