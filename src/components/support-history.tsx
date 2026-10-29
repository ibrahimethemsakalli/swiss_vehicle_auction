'use client';
import { useEffect, useState, useRef } from 'react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from './ui/dialog';
import { Button } from './ui/button';
import { useLocale } from './providers';
import { loadSupportHistory, type SupportHistoryPage } from '../lib/support-history';
import { historyFilters } from '../lib/support-history-search';
import { Input } from './ui/input';
import { supportMessageHref } from '../lib/support-message-link';

export function SupportHistory({
  id,
  admin,
  start,
  startContext,
  onClose,
}: {
  id: string;
  admin: boolean;
  start: number;
  startContext?: string;
  onClose: () => void;
}) {
  const { t, date, locale } = useLocale();
  const [link, setLink] = useState('');
  const [page, setPage] = useState(start);
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<SupportHistoryPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [text, setText] = useState(''),
    [from, setFrom] = useState(''),
    [to, setTo] = useState('');
  const [invalid, setInvalid] = useState(false);
  const [filters, setFilters] = useState<{ message?: string; from?: string; to?: string }>({});
  const [context, setContext] = useState(startContext ?? '');
  const anchor = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (context && result) anchor.current?.scrollIntoView({ block: 'nearest' });
  }, [context, result]);
  const [back, setBack] = useState<{ filters: typeof filters; page: number } | null>(null);
  const searching = Object.keys(filters).length > 0 && !context;
  const displayedPage = result?.resolvedPage ?? page;
  const move = (next: number) => {
    if (context) {
      setContext('');
      setFilters({});
    }
    setPage(next);
  };
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    setFailed(false);
    setResult(null);
    loadSupportHistory(fetch, id, admin, page, abort.signal, context ? { context } : filters)
      .then((data) => {
        if (!abort.signal.aborted) {
          setResult(data);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!abort.signal.aborted) {
          setFailed(true);
          setLoading(false);
        }
      });
    return () => abort.abort();
  }, [id, admin, page, retry, filters, context]);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent wide>
        <DialogTitle className="pr-8">{t('shTitle')}</DialogTitle>
        <DialogDescription className="my-3">{t('shHint')}</DialogDescription>
        {startContext && <p>{t('mlAccess')}</p>}
        {link && (
          <div className="border rounded p-3 my-2 break-all">
            <label>
              {t('mlLink')}
              <Input readOnly value={link} onFocus={(e) => e.target.select()} />
            </label>
            <a className="underline" href={link}>
              {t('mlOpen')}
            </a>
            <p>{t('mlAccess')}</p>
          </div>
        )}
        <form
          className="space-y-2 my-2"
          onSubmit={(e) => {
            e.preventDefault();
            const parsed = historyFilters.safeParse({
              message: text,
              from: from || undefined,
              to: to || undefined,
            });
            setInvalid(!parsed.success);
            if (!parsed.success) return;
            setFilters({
              message: parsed.data.message,
              ...(from ? { from } : {}),
              ...(to ? { to } : {}),
            });
            setPage(1);
            setContext('');
            setBack(null);
          }}
        >
          <label>
            {t('hsText')}
            <Input value={text} maxLength={160} onChange={(e) => setText(e.target.value)} />
          </label>
          <div className="flex flex-wrap gap-3">
            <label>
              {t('hsFrom')}
              <Input
                type="date"
                value={from}
                onInput={(e) => setFrom(e.currentTarget.value)}
                onChange={(e) => setFrom(e.target.value)}
              />
            </label>
            <label>
              {t('hsTo')}
              <Input
                type="date"
                value={to}
                onInput={(e) => setTo(e.currentTarget.value)}
                onChange={(e) => setTo(e.target.value)}
              />
            </label>
          </div>
          <p>{t('hsUTC')}</p>
          {invalid && <p role="alert">{t('hsInvalid')}</p>}
          <div className="flex flex-wrap gap-3">
            <Button type="submit" disabled={loading}>
              {t('hsSearch')}
            </Button>
            <Button
              type="button"
              onClick={() => {
                setText('');
                setFrom('');
                setTo('');
                setFilters({});
                setContext('');
                setBack(null);
                setPage(1);
                setInvalid(false);
              }}
            >
              {t('sqClear')}
            </Button>
          </div>
        </form>
        {back && (
          <Button
            onClick={() => {
              setFilters(back.filters);
              setPage(back.page);
              setContext('');
              setBack(null);
            }}
          >
            {t('hsBack')}
          </Button>
        )}
        <div className="flex flex-wrap gap-3 my-3">
          <Button disabled={loading || displayedPage === 1} onClick={() => move(1)}>
            {t('shOldest')}
          </Button>
          <Button disabled={loading || page === 0 || searching} onClick={() => move(0)}>
            {t('shLatest')}
          </Button>
          <Button onClick={onClose}>{t('shReturn')}</Button>
        </div>
        <p>
          {page === 0 ? t('shLatest') : t('shPage', { page: displayedPage })}{' '}
          {back && t('hsContextView')}
        </p>
        {loading && <p role="status">{t('loading')}</p>}
        {failed && (
          <div role="alert">
            <p>{context ? t('mlUnavailable') : t('spFailed')}</p>
            <Button onClick={() => setRetry((v) => v + 1)}>{t('spRefresh')}</Button>
          </div>
        )}
        {result && (
          <>
            <ol
              key={page}
              className="space-y-3 max-h-[40dvh] overflow-y-auto overscroll-contain"
              tabIndex={0}
              aria-label={t('shTitle')}
            >
              {result.entries.map((entry) => (
                <li
                  key={entry.id}
                  ref={context === entry.id ? anchor : undefined}
                  className={`border rounded-xl p-3 ${context === entry.id ? 'border-emerald-600 bg-emerald-50' : ''}`}
                >
                  <strong>{t(entry.staff ? 'spStaff' : 'spUser')}</strong> · {date(entry.createdAt)}
                  <p className="whitespace-pre-wrap break-words">{entry.body}</p>
                  {context === entry.id && <strong>{t('mlSelected')}</strong>}
                  <Button
                    onClick={() =>
                      setLink(
                        window.location.origin + supportMessageHref(id, entry.id, admin, locale),
                      )
                    }
                  >
                    {t('mlCreate')}
                  </Button>
                  {searching && (
                    <Button
                      onClick={() => {
                        setBack({ filters, page });
                        setContext(entry.id);
                      }}
                    >
                      {t('hsContext')}
                    </Button>
                  )}
                </li>
              ))}
            </ol>
            {!result.entries.length && <p>{t('shEmpty')}</p>}
            <div className="flex flex-wrap gap-3 my-3">
              <Button disabled={displayedPage <= 1} onClick={() => move(displayedPage - 1)}>
                {t('spPrevious')}
              </Button>
              <Button disabled={page === 0 || !result.more} onClick={() => move(displayedPage + 1)}>
                {t('spNext')}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
