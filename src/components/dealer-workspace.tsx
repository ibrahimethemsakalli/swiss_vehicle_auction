'use client';
import Link from 'next/link';
import { useEffect, useState, useRef } from 'react';
import { useLocale, type MessageKey } from './providers';
import { useResource, Loading, ErrorState } from './common';
import { Input } from './ui/input';
import { Textarea, Select } from './ui/form-controls';
import { Button } from './ui/button';
import { cantons } from '../lib/market-types';
import {
  dealerTemplate as template,
  csvColumns,
  csvAllowedValues,
} from '../lib/dealer-import-format';
type Profile = {
  userId?: string;
  name: string;
  canton: string;
  city: string;
  postalCode: string;
  description: string;
  published: boolean;
  version: number;
};
type Preview = {
  hash: string;
  remaining: number;
  rows: {
    row: number;
    make: string;
    model: string;
    issues: { row: number; field: string; code: string }[];
  }[];
};
function download(name: string, content: string) {
  const url = URL.createObjectURL(
    new Blob(['\uFEFF' + content], { type: 'text/csv;charset=utf-8' }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function DealerWorkspace() {
  const { t } = useLocale();
  const resource = useResource<{ profile: Profile | null; companyName: string; remaining: number }>(
    '/api/dealer',
  );
  const [profile, setProfile] = useState<Profile>({
    name: '',
    canton: 'ZH',
    city: '',
    postalCode: '',
    description: '',
    published: false,
    version: 0,
  });
  const [csv, setCsv] = useState(''),
    [preview, setPreview] = useState<Preview | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState<MessageKey | null>(null),
    [ids, setIds] = useState<string[]>([]),
    [requestId, setRequestId] = useState('');
  const loaded = useRef(false);
  const [publicId, setPublicId] = useState<string | null>(null);
  useEffect(() => {
    if (resource.data && !loaded.current) {
      loaded.current = true;
      setProfile(
        resource.data.profile ?? {
          name: resource.data.companyName,
          canton: 'ZH',
          city: '',
          postalCode: '',
          description: '',
          published: false,
          version: 0,
        },
      );
      setPublicId(resource.data.profile?.published ? (resource.data.profile.userId ?? null) : null);
    }
  }, [resource.data]);
  const resetCsv = (text: string) => {
    setCsv(text);
    setPreview(null);
    setIds([]);
    setMessage(null);
    setRequestId(crypto.randomUUID());
  };
  async function send(action: 'profile' | 'preview' | 'import') {
    setBusy(true);
    setMessage(null);
    try {
      const payload =
        action === 'profile'
          ? {
              action,
              version: profile.version,
              name: profile.name,
              canton: profile.canton,
              city: profile.city,
              postalCode: profile.postalCode,
              description: profile.description,
              published: profile.published,
            }
          : action === 'preview'
            ? { action, csv }
            : { action, csv, hash: preview?.hash, requestId };
      const r = await fetch('/api/dealer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await r.json();
      if (!r.ok) {
        const map: Record<string, MessageKey> = {
          CSV_FORMAT: 'dealerCsvFormat',
          CSV_LIMIT: 'dealerCsvLimit',
          CSV_ERRORS: 'dealerCsvErrors',
          DRAFT_QUOTA: 'dealerQuota',
          CONFLICT: 'dealerConflict',
          PREVIEW_CHANGED: 'dealerConflict',
          FORBIDDEN: 'dealerRole',
          VERIFICATION_REQUIRED: 'dealerRole',
        };
        setMessage(map[data.error] ?? 'dealerFailed');
        return;
      }
      if (action === 'profile') {
        setProfile(data);
        setPublicId(data.published ? data.userId : null);
        setMessage('dealerSaved');
      }
      if (action === 'preview') {
        setPreview(data);
        setRequestId(crypto.randomUUID());
      }
      if (action === 'import') {
        setIds(data.draftIds);
        setMessage('dealerImported');
        setPreview(null);
        resource.reload();
      }
    } catch {
      setMessage('dealerFailed');
    } finally {
      setBusy(false);
    }
  }
  const issueKey = (code: string): MessageKey =>
    code === 'duplicate'
      ? 'dealerDuplicate'
      : code === 'formula'
        ? 'dealerFormula'
        : code === 'required'
          ? 'dealerRequired'
          : 'dealerInvalid';
  if (resource.loading) return <Loading />;
  if (resource.error)
    return (
      <div className="container py-8">
        <p>{t('dealerRole')}</p>
        {resource.error !== 401 && resource.error !== 403 && <ErrorState code={resource.error} retry={resource.reload} />}
        <Link href="/login?next=/dealer">{t('login')}</Link>
      </div>
    );
  return (
    <div className="container py-8 min-w-0">
      <h1 className="text-2xl font-bold">{t('dealerTitle')}</h1>
      <p className="my-4">{t('dealerNotice')}</p>
      {message && (
        <p className="notice my-4" role="status">
          {t(message)}
        </p>
      )}
      <section className="panel p-4">
        <h2>{t('dealerProfile')}</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send('profile');
          }}
          className="grid gap-4"
        >
          <label>
            {t('dealerName')}
            <Input
              required
              minLength={2}
              maxLength={120}
              value={profile.name}
              onChange={(e) => setProfile({ ...profile, name: e.target.value })}
            />
          </label>
          <label>
            {t('canton')}
            <Select
              value={profile.canton}
              onChange={(e) => setProfile({ ...profile, canton: e.target.value })}
            >
              {cantons.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
          </label>
          <label>
            {t('dealerCity')}
            <Input
              required
              maxLength={80}
              value={profile.city}
              onChange={(e) => setProfile({ ...profile, city: e.target.value })}
            />
          </label>
          <label>
            {t('dealerPostal')}
            <Input
              required
              pattern="[0-9]{4}"
              maxLength={4}
              inputMode="numeric"
              value={profile.postalCode}
              onChange={(e) => setProfile({ ...profile, postalCode: e.target.value })}
            />
          </label>
          <label>
            {t('dealerDescription')}
            <Textarea
              maxLength={1500}
              value={profile.description}
              onChange={(e) => setProfile({ ...profile, description: e.target.value })}
            />
          </label>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={profile.published}
              onChange={(e) => setProfile({ ...profile, published: e.target.checked })}
            />
            {t('dealerPublish')}
          </label>
          <Button disabled={busy} type="submit">
            {t('dealerSave')}
          </Button>
          {publicId && (
            <Link className="underline break-all" href={`/dealers/${publicId}`}>
              {t('dealerPublicLink')}
            </Link>
          )}
        </form>
      </section>
      <section className="panel p-4 mt-6">
        <h2>{t('dealerCsv')}</h2>
        <p className="my-3">{t('dealerCsvHint')}</p>
        <p>{t('dealerRemaining', { count: resource.data?.remaining ?? 0 })}</p>
        <Button
          className="my-3"
          variant="outline"
          onClick={() => download('vehicle-template.csv', template)}
        >
          {t('dealerTemplate')}
        </Button>
        <details className="my-3">
          <summary>{t('dealerFormat')}</summary>
          <p className="break-words">{csvColumns.join(', ')}</p>
          <pre className="whitespace-pre-wrap break-words text-sm">{csvAllowedValues}</pre>
        </details>
        <label className="block mb-4">
          {t('dealerFile')}
          <Input
            type="file"
            accept=".csv,text/csv"
            disabled={busy}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              resetCsv('');
              if (file.size > 256000) {
                setMessage('dealerCsvLimit');
                return;
              }
              try {
                resetCsv(
                  new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()),
                );
              } catch {
                setMessage('dealerCsvFormat');
              }
            }}
          />
        </label>
        <label>
          {t('dealerPaste')}
          <Textarea
            rows={7}
            maxLength={256000}
            value={csv}
            disabled={busy}
            onChange={(e) => resetCsv(e.target.value)}
          />
        </label>
        <Button
          className="my-3"
          disabled={busy || !csv.trim()}
          onClick={() => void send('preview')}
        >
          {t('dealerPreview')}
        </Button>
        {preview && (
          <>
            <h3>{t('dealerPreviewTitle')}</h3>
            <ol className="grid gap-3 my-4">
              {preview.rows.map((row) => (
                <li className="border rounded-lg p-3 break-words" key={row.row}>
                  <strong>
                    {row.row}: {row.make} {row.model}
                  </strong>
                  <ul>
                    {row.issues.map((issue, i) => (
                      <li key={i}>
                        {issue.field}: {t(issueKey(issue.code))}
                      </li>
                    ))}
                  </ul>
                  {!row.issues.length && <p>{t('dealerValid')}</p>}
                </li>
              ))}
            </ol>
            {preview.rows.some((r) => r.issues.length > 0) && (
              <Button
                variant="outline"
                onClick={() =>
                  download(
                    'import-errors.csv',
                    'record,field,error\n' +
                      preview.rows
                        .flatMap((r) =>
                          r.issues.map((i) =>
                            [i.row, i.field, t(issueKey(i.code))]
                              .map((v) => '"' + String(v).replaceAll('"', '""') + '"')
                              .join(','),
                          ),
                        )
                        .join('\n'),
                  )
                }
              >
                {t('dealerErrorsDownload')}
              </Button>
            )}
            {preview.rows.length > preview.remaining && <p role="alert">{t('dealerQuota')}</p>}
            <Button
              className="my-4"
              disabled={
                busy ||
                preview.rows.some((r) => r.issues.length > 0) ||
                preview.rows.length > preview.remaining
              }
              onClick={() => void send('import')}
            >
              {t('dealerImport')}
            </Button>
          </>
        )}
        {!!ids.length && (
          <ul className="grid gap-2">
            {ids.map((id, i) => (
              <li key={id}>
                <Link className="underline" href={`/sell?draft=${id}`}>
                  {t('dealerOpenDraft', { number: i + 1 })}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      <Link href="/drafts">{t('draftsTitle')}</Link>
    </div>
  );
}
export function DealerPublic({ id }: { id: string }) {
  const { t, locale } = useLocale();
  const [page, setPage] = useState(1);
  const { data, error, loading, reload } = useResource<{
    profile: Profile;
    vehicles: { id: string; make: string; model: string }[];
    page: number;
    total: number;
  }>(`/api/dealers/${encodeURIComponent(id)}?page=${page}`);
  if (loading) return <Loading />;
  if (error || !data) return <ErrorState code={error} retry={reload} />;
  return (
    <div className="container py-8">
      <h1 className="text-2xl font-bold break-words">{data.profile.name}</h1>
      <p>
        {data.profile.postalCode} {data.profile.city} · {data.profile.canton}
      </p>
      <p className="notice my-4">{t('dealerNotice')}</p>
      <p className="whitespace-pre-wrap break-words">{data.profile.description}</p>
      <h2 className="mt-6 font-bold">{t('dealerStock')}</h2>
      {!data.vehicles.length && <p>{t('dealerNoStock')}</p>}
      <ul className="grid gap-4 my-4">
        {data.vehicles.map((v) => (
          <li key={v.id}>
            <Link className="underline break-words" href={`/vehicles/${v.id}?lang=${locale}`}>
              {v.make} {v.model}
            </Link>
          </li>
        ))}
      </ul>
      <nav className="flex flex-wrap gap-3">
        <Button variant="outline" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
          {t('listingStatsPrevious')}
        </Button>
        <span>
          {page} / {Math.max(1, Math.ceil(data.total / 12))}
        </span>
        <Button
          variant="outline"
          disabled={page * 12 >= data.total}
          onClick={() => setPage((p) => p + 1)}
        >
          {t('listingStatsNext')}
        </Button>
      </nav>
    </div>
  );
}
