'use client';
import { Textarea } from './ui/form-controls';
import Link from 'next/link';
import { Settlements } from './settlements';
import { Offers } from './offers';
import { Disputes } from './disputes';
import { IdentityReviews } from './identity-reviews';
import { PaymentHold } from './payment-hold';
import { useState } from 'react';
import {
  ArrowRight,
  CarFront,
  CheckCircle2,
  ClipboardCheck,
  CreditCard,
  Gavel,
  LayoutDashboard,
  Plus,
  ShieldCheck,
  Trophy,
} from 'lucide-react';
import type { VehicleView } from '../lib/market-types';
import { useLocale, type MessageKey } from './providers';
import {
  Countdown,
  DemoBanner,
  EmptyState,
  ErrorState,
  Loading,
  SellerBadge,
  StatusBadge,
  useResource,
  VehicleImage,
} from './common';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog';
type Bid = {
  id: string;
  amount: number;
  status: string;
  vehicle: VehicleView;
  hold?: { status: string; expiresAt: string };
};
type Payment = { id: string; amount: number; status: string; vehicle: string };
type Account = {
  demo: boolean;
  user: { role: string; verified: boolean };
  vehicles: VehicleView[];
  bids: Bid[];
  holds: Payment[];
  offers: Payment[];
};
function SignInGate() {
  const { t } = useLocale();
  return (
    <div className="empty-state">
      <ShieldCheck size={38} />
      <h2>{t('signInRequired')}</h2>
      <Button asChild>
        <Link href="/login">
          {t('login')}
          <ArrowRight size={16} />
        </Link>
      </Button>
    </div>
  );
}
function DashboardNav({
  tab,
  setTab,
  admin = false,
}: {
  tab: string;
  setTab: (s: string) => void;
  admin?: boolean;
}) {
  const { t } = useLocale();
  const keys = admin
    ? ['queue', 'payments', 'identities', 'settlements', 'disputes']
    : ['overview', 'buyer', 'sellerTab', 'holds', 'fixedOffers', 'settlements', 'disputes'];
  const icons = admin
    ? [ClipboardCheck, CreditCard, ShieldCheck, Gavel, ClipboardCheck]
    : [LayoutDashboard, Gavel, CarFront, CreditCard, Gavel, ClipboardCheck, ShieldCheck];
  return (
    <aside className="dashboard-nav">
      <div className="dashboard-identity">
        <span>
          <ShieldCheck size={24} />
        </span>
        <strong>
          AutoVeri<span>{t(admin ? 'admin' : 'garage')}</span>
        </strong>
      </div>
      <nav aria-label={t(admin ? 'admin' : 'garage')}>
        {keys.map((key, i) => {
          const Icon = icons[i];
          return (
            <button
              key={key}
              aria-current={tab === key ? 'page' : undefined}
              onClick={() => setTab(key)}
              className={tab === key ? 'selected' : ''}
            >
              <Icon size={18} />
              {t(key as MessageKey)}
            </button>
          );
        })}
      </nav>
      <div className="dashboard-nav-note">
        <ShieldCheck size={22} />
        <p>{t('footerNote')}</p>
      </div>
    </aside>
  );
}
function Stats({
  items,
}: {
  items: { label: MessageKey; value: string | number; icon: typeof CarFront }[];
}) {
  const { t } = useLocale();
  return (
    <div className="stat-grid">
      {items.map(({ label, value, icon: Icon }) => (
        <div className="stat-card" key={label}>
          <span>
            <Icon size={21} />
          </span>
          <small>{t(label)}</small>
          <strong>{value}</strong>
        </div>
      ))}
    </div>
  );
}
function PaymentsTable({ rows, admin = false }: { rows: Payment[]; admin?: boolean }) {
  const { t, money } = useLocale();
  if (!rows.length) return <EmptyState />;
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>{t('vehicle')}</th>
            <th>{t('amount')}</th>
            <th>{t('status')}</th>
            {admin && <th>{t('payments')}</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.id}>
              <td>{p.vehicle}</td>
              <td>{money(p.amount)}</td>
              <td>
                <StatusBadge status={p.status} />
              </td>
              {admin && (
                <td>
                  <div className="payment-actions">
                    <Button size="sm" variant="outline" disabled>
                      {t('captureFee')}
                    </Button>
                    <Button size="sm" variant="outline" disabled>
                      {t('captureCompensation')}
                    </Button>
                    <Button size="sm" variant="outline" disabled>
                      {t('release')}
                    </Button>
                  </div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function BidRows({ rows }: { rows: Bid[] }) {
  const { t, money } = useLocale();
  if (!rows.length) return <EmptyState />;
  return (
    <div className="activity-list">
      {rows.map((b) => (
        <div key={b.id} className="activity-row">
          <VehicleImage src={b.vehicle.images[0]} alt={`${b.vehicle.make} ${b.vehicle.model}`} />
          <div>
            <Link href={`/vehicles/${b.vehicle.id}`}>
              {b.vehicle.make} {b.vehicle.model}
            </Link>
            <Countdown end={b.vehicle.end} />
            {b.status === 'ACTIVE' &&
              b.hold &&
              (b.hold.status !== 'AUTHORIZED' ||
                Date.parse(b.hold.expiresAt) < Date.now() + 86400000) && (
                <PaymentHold
                  vehicleId={b.vehicle.id}
                  replacementBidId={b.id}
                  onAuthorized={() => window.location.reload()}
                />
              )}
          </div>
          <strong>{money(b.amount)}</strong>
          <StatusBadge status={b.status} />
        </div>
      ))}
    </div>
  );
}
export function UserDashboard() {
  const { t, money } = useLocale();
  const { data, error, loading, reload } = useResource<Account>('/api/account');
  const [tab, setTab] = useState('overview');
  if (loading) return <Loading />;
  if (error === 401) return <SignInGate />;
  if (error || !data) return <ErrorState retry={reload} code={error} />;
  const active = data.bids.filter((b) => b.status === 'ACTIVE');
  const won = data.bids.filter((b) => b.status === 'WON');
  return (
    <>
      {data.demo && <DemoBanner />}
      <div className="container dashboard-page">
        <DashboardNav tab={tab} setTab={setTab} />
        <div className="dashboard-content">
          <div className="page-heading dashboard-heading">
            <div>
              <p className="eyebrow">{t('garage')}</p>
              <h1>{t('welcome')}</h1>
              <p>{t('garageIntro')}</p>
            </div>
            <Button asChild>
              <Link href="/sell">
                <Plus size={16} />
                {t('sell')}
              </Link>
            </Button>
          </div>
          <Stats
            items={[
              { label: 'activeBids', value: active.length, icon: Gavel },
              { label: 'won', value: won.length, icon: Trophy },
              { label: 'myVehicles', value: data.vehicles.length, icon: CarFront },
              {
                label: 'holds',
                value: money(
                  data.holds
                    .filter((h) => h.status === 'AUTHORIZED')
                    .reduce((sum, h) => sum + h.amount, 0),
                ),
                icon: CreditCard,
              },
            ]}
          />
          {!data.demo && !data.user.verified && (
            <p className="notice mb-6">
              {t('verifiedRequired')} <Link href="/verify">{t('verifyAccount')}</Link>
            </p>
          )}
          {(tab === 'overview' || tab === 'buyer') && (
            <>
              <section className="panel">
                <div className="panel-heading">
                  <h2>
                    <Gavel size={19} />
                    {t('activeBids')}
                  </h2>
                  <Link href="/">
                    {t('explore')}
                    <ArrowRight size={15} />
                  </Link>
                </div>
                <BidRows rows={active} />
              </section>
              <section className="panel">
                <h2>
                  <Trophy size={19} />
                  {t('won')}
                </h2>
                <BidRows rows={won} />
              </section>
            </>
          )}
          {(tab === 'overview' || tab === 'sellerTab') && (
            <section className="panel">
              <h2>
                <CarFront size={19} />
                {t('myVehicles')}
              </h2>
              {!data.vehicles.length ? (
                <EmptyState />
              ) : (
                <div className="activity-list">
                  {data.vehicles.map((v) => (
                    <div className="activity-row" key={v.id}>
                      <VehicleImage src={v.images[0]} alt={`${v.make} ${v.model}`} />
                      <div>
                        <strong>
                          {v.make} {v.model}
                        </strong>
                        <small>
                          {v.canton} · {money(v.price)}
                        </small>
                      </div>
                      <StatusBadge status={v.status} />
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={data.demo || !['EXPIRED', 'SOLD'].includes(v.status)}
                        onClick={() => setTab('settlements')}
                      >
                        {t('confirmSale')}
                      </Button>
                    </div>
                  ))}
                </div>
              )}
              <p className="fine-print mt-5">{t('settlementHelp')}</p>
            </section>
          )}
          {tab === 'sellerTab' && (
            <section className="panel">
              <h2>{t('incoming')}</h2>
              <PaymentsTable rows={data.offers} />
            </section>
          )}
          {(tab === 'holds' || tab === 'overview') && (
            <section className="panel">
              <h2>
                <CreditCard size={19} />
                {t('holds')}
              </h2>
              <PaymentsTable rows={data.holds} />
              <p className="fine-print mt-5">{t('holdExplanation')}</p>
            </section>
          )}
          {tab === 'settlements' && !data.demo && <Settlements />}
          {tab === 'fixedOffers' && !data.demo && <Offers />}
          {tab === 'disputes' && !data.demo && <Disputes />}
          {data.user.role === 'ADMIN' && (
            <Button asChild variant="outline">
              <Link href="/admin">
                {t('admin')}
                <ArrowRight size={16} />
              </Link>
            </Button>
          )}
        </div>
      </div>
    </>
  );
}
type ReviewVehicle = VehicleView & { vinChassis: string };
type AdminData = { demo: boolean; queue: ReviewVehicle[]; payments: Payment[] };
export function AdminDashboard() {
  const { t } = useLocale();
  const { data, error, loading, reload } = useResource<AdminData>('/api/admin');
  const [tab, setTab] = useState('queue');
  const [selected, setSelected] = useState<ReviewVehicle | null>(null);
  const [message, setMessage] = useState<MessageKey | null>(null);
  if (loading) return <Loading />;
  if (error === 401) return <SignInGate />;
  if (error || !data) return <ErrorState code={error} retry={reload} />;
  return (
    <>
      {data.demo && <DemoBanner />}
      <div className="container dashboard-page">
        <DashboardNav tab={tab} setTab={setTab} admin />
        <div className="dashboard-content">
          <div className="page-heading">
            <p className="eyebrow">AUTOVERI / {t('admin')}</p>
            <h1>{t('adminTitle')}</h1>
            <p>{t('adminIntro')}</p>
          </div>
          <Stats
            items={[
              { label: 'queue', value: data.queue.length, icon: ClipboardCheck },
              {
                label: 'AUTHORIZED',
                value: data.payments.filter((p) => p.status === 'AUTHORIZED').length,
                icon: CreditCard,
              },
              {
                label: 'RELEASE_PENDING',
                value: data.payments.filter((p) => p.status === 'RELEASE_PENDING').length,
                icon: CheckCircle2,
              },
            ]}
          />
          {message && (
            <p className="notice success mb-5" role="status">
              {t(message)}
            </p>
          )}
          {tab === 'disputes' ? (
            data.demo ? (
              <EmptyState />
            ) : (
              <Disputes />
            )
          ) : tab === 'settlements' ? (
            data.demo ? (
              <EmptyState />
            ) : (
              <Settlements />
            )
          ) : tab === 'identities' ? (
            data.demo ? (
              <EmptyState />
            ) : (
              <IdentityReviews />
            )
          ) : tab === 'queue' ? (
            <section className="panel">
              <h2>
                <ClipboardCheck size={20} />
                {t('queue')}
              </h2>
              {data.queue.length ? (
                <div className="review-grid">
                  {data.queue.map((v) => (
                    <article className="review-card" key={v.id}>
                      <VehicleImage src={v.images[0]} alt={`${v.make} ${v.model}`} />
                      <div>
                        <StatusBadge status={v.status} />
                        <h3>
                          {v.make} {v.model}
                        </h3>
                        <SellerBadge vehicle={v} />
                        <p>
                          {v.canton} · {v.stammnummer}
                        </p>
                        <Button variant="outline" onClick={() => setSelected(v)}>
                          {t('review')}
                          <ArrowRight size={15} />
                        </Button>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <EmptyState />
              )}
            </section>
          ) : (
            <section className="panel">
              <h2>{t('payments')}</h2>
              <Button variant="outline" onClick={() => setTab('settlements')}>
                {t('settlements')}
              </Button>
              <PaymentsTable rows={data.payments} />
            </section>
          )}
        </div>
      </div>
      <Dialog
        open={!!selected}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        {selected && (
          <ReviewDialog
            key={selected.id}
            vehicle={selected}
            demo={data.demo}
            onSaved={() => {
              setSelected(null);
              setMessage('reviewSuccess');
              reload();
            }}
          />
        )}
      </Dialog>
    </>
  );
}
function ReviewDialog({
  vehicle,
  demo,
  onSaved,
}: {
  vehicle: ReviewVehicle;
  demo: boolean;
  onSaved: () => void;
}) {
  const { t } = useLocale();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [action, setAction] = useState('approve');
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(false);
    try {
      const response = await fetch('/api/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: vehicle.id, action, ...Object.fromEntries(form) }),
      });
      if (!response.ok) throw new Error();
      onSaved();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <DialogContent wide className="admin-review-dialog">
      <DialogTitle className="text-2xl font-semibold pr-8">{t('reviewTitle')}</DialogTitle>
      <DialogDescription className="text-sm text-slate-500 my-4">
        {t('reviewHint')}
      </DialogDescription>
      <form onSubmit={(e) => void submit(e)}>
        <div className="form-grid">
          {[
            ['make', 'make', vehicle.make],
            ['model', 'model', vehicle.model],
            ['stammnummer', 'stammnummer', vehicle.stammnummer],
            ['vinChassis', 'vinFull', vehicle.vinChassis],
            ['firstRegistration', 'registration', vehicle.firstRegistration?.slice(0, 10) ?? ''],
            ['mfkDate', 'inspection', vehicle.mfkDate.slice(0, 10)],
          ].map(([name, label, value]) => (
            <label className="form-label" key={name}>
              {t(label as MessageKey)}
              <Input
                name={name}
                defaultValue={value}
                type={name === 'mfkDate' || name === 'firstRegistration' ? 'date' : 'text'}
                required
              />
            </label>
          ))}
        </div>
        <label className="form-label mt-4">
          {t('reviewNote')}
          <Textarea
            className="field"
            name="note"
            minLength={5}
            maxLength={2000}
            rows={3}
            required
          />
        </label>
        {error && (
          <p className="notice" role="alert">
            {t('reviewFailed')}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-3 mt-6">
          <Button
            type="submit"
            variant="outline"
            disabled={demo || busy}
            onClick={() => setAction('reject')}
          >
            {t('reject')}
          </Button>
          <Button
            type="submit"
            variant="green"
            disabled={demo || busy}
            onClick={() => setAction('approve')}
          >
            {busy ? t('loading') : t('approve')}
          </Button>
        </div>
        {demo && <p className="fine-print mt-4">{t('demoSubmit')}</p>}
      </form>
    </DialogContent>
  );
}
