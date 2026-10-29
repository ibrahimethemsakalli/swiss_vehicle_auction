'use client';
import { createContext, useContext, useEffect, useState } from 'react';
import { useLocale } from './providers';
import { Button } from './ui/button';
type InstallEvent = Event & { prompt(): Promise<{ outcome: 'accepted' | 'dismissed' }> };
const Context = createContext<{
  enabled: boolean;
  secure: boolean;
  ready: boolean;
  failed: boolean;
  installed: boolean;
  prompt: InstallEvent | null;
}>({ enabled: false, secure: false, ready: false, failed: false, installed: false, prompt: null });
export function PwaProvider({
  enabled,
  children,
}: {
  enabled: boolean;
  children: React.ReactNode;
}) {
  const [state, setState] = useState({
    secure: false,
    ready: false,
    failed: false,
    installed: false,
    prompt: null as InstallEvent | null,
  });
  useEffect(() => {
    let active = true;
    const standalone = window.matchMedia('(display-mode: standalone)');
    const installed = () => setState((s) => ({ ...s, installed: true, prompt: null }));
    const capture = (event: Event) => {
      event.preventDefault();
      setState((s) => ({ ...s, prompt: event as InstallEvent }));
    };
    setState((s) => ({
      ...s,
      secure: window.isSecureContext,
      installed:
        standalone.matches ||
        (navigator as Navigator & { standalone?: boolean }).standalone === true,
    }));
    if (!enabled) {
      if ('serviceWorker' in navigator)
        void navigator.serviceWorker
          .getRegistrations()
          .then((registrations) =>
            Promise.all(
              registrations
                .filter((r) =>
                  [r.active, r.waiting, r.installing].some(
                    (w) => w && new URL(w.scriptURL).pathname === '/sw.js',
                  ),
                )
                .map((r) => r.unregister()),
            ),
          )
          .catch(() => {});
      return;
    }
    if (!window.isSecureContext || !('serviceWorker' in navigator)) {
      setState((s) => ({ ...s, failed: true }));
      return;
    }
    window.addEventListener('beforeinstallprompt', capture);
    window.addEventListener('appinstalled', installed);
    void navigator.serviceWorker
      .register('/sw.js', { scope: '/', updateViaCache: 'none' })
      .then(async (registration) => {
        const installing = registration.installing;
        installing?.addEventListener('statechange', () => {
          if (active && installing.state === 'redundant') setState((s) => ({ ...s, failed: true }));
        });
        await navigator.serviceWorker.ready;
        if (active) setState((s) => ({ ...s, ready: true }));
        // No forced reload or skipWaiting: updates activate when existing tabs close.
        void registration.update().catch(() => {});
      })
      .catch(() => {
        if (active) setState((s) => ({ ...s, failed: true }));
      });
    return () => {
      active = false;
      window.removeEventListener('beforeinstallprompt', capture);
      window.removeEventListener('appinstalled', installed);
    };
  }, [enabled]);
  return <Context.Provider value={{ enabled, ...state }}>{children}</Context.Provider>;
}
export function InstallApp() {
  const { t } = useLocale(),
    state = useContext(Context);
  const [busy, setBusy] = useState(false),
    [dismissed, setDismissed] = useState(false),
    [used, setUsed] = useState<InstallEvent | null>(null);
  return (
    <section className="container py-8 max-w-2xl min-w-0 break-words">
      <h1 className="text-2xl font-bold">{t('pwaTitle')}</h1>
      <p className="my-4">{t('pwaDescription')}</p>
      <p className="notice my-4" role="status">
        {t(
          !state.enabled
            ? 'pwaDisabled'
            : !state.secure
              ? 'pwaSecure'
              : state.failed
                ? 'pwaFailed'
                : state.installed
                  ? 'pwaInstalled'
                  : state.ready
                    ? 'pwaReady'
                    : 'pwaPreparing',
        )}
      </p>
      {state.enabled &&
        state.ready &&
        !state.installed &&
        state.prompt &&
        state.prompt !== used && (
          <Button
            disabled={busy}
            onClick={async () => {
              const prompt = state.prompt!;
              setBusy(true);
              setDismissed(false);
              setUsed(prompt);
              try {
                const result = await prompt.prompt();
                setDismissed(result.outcome === 'dismissed');
              } catch {
                setDismissed(true);
              } finally {
                setBusy(false);
              }
            }}
          >
            {t('pwaInstall')}
          </Button>
        )}
      {dismissed && (
        <p role="status" className="my-3">
          {t('pwaDismissed')}
        </p>
      )}
      <h2 className="font-bold mt-6">{t('pwaManualTitle')}</h2>
      <p className="my-3">{t('pwaManual')}</p>
      <h2 className="font-bold mt-6">{t('pwaOfflineSection')}</h2>
      <p className="my-3">{t('pwaPrivacy')}</p>
      <p className="my-3">{t('pwaNoPush')}</p>
      <a className="underline" href="/offline.html">
        {t('pwaPreview')}
      </a>
    </section>
  );
}
