'use client';
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useLocale } from './providers';
import { Button } from './ui/button';
export function LocalTestBanner() {
  const path = usePathname();
  const { status } = useSession();
  const { t } = useLocale();
  const [mode, setMode] = useState({ enabled: false, canClose: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const vehicleId = path.startsWith('/vehicles/') ? path.split('/')[2] : '';
  useEffect(() => {
    let active = true;
    fetch(`/api/local-test${vehicleId ? `?vehicleId=${encodeURIComponent(vehicleId)}` : ''}`)
      .then((r) => r.json())
      .then((data) => {
        if (active) setMode(data);
      })
      .catch(() => {
        if (active) setMode({ enabled: false, canClose: false });
      });
    return () => {
      active = false;
    };
  }, [path, status, vehicleId]);
  if (!mode.enabled) return null;
  return (
    <aside className="notice container" role="status">
      <strong>{t('localPaymentNotice')}</strong>
      {mode.canClose && (
        <Button
          className="mt-3"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(false);
            try {
              const result = await fetch('/api/local-test', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ vehicleId }),
              });
              if (!result.ok) throw new Error();
              window.location.reload();
            } catch {
              setError(true);
              setBusy(false);
            }
          }}
        >
          {t('localCloseAuction')}
        </Button>
      )}
      {error && <p>{t('paymentFailed')}</p>}
    </aside>
  );
}
