'use client';
import { Select, Textarea } from './ui/form-controls';
import Link from 'next/link';
import { SpecFields, EquipmentFields } from './vehicle-spec-fields';
import { specNumbers } from '../lib/vehicle-specs';
import { useEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  Check,
  CheckCircle2,
  FileScan,
  ImagePlus,
  LockKeyhole,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { useLocale, type MessageKey } from './providers';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { DemoBanner, useResource, VehicleImage } from './common';
import { cantons } from '../lib/market-types';
import { vehicleCatalog } from '../lib/vehicle-catalog';
import { ValidationErrors } from './validation-errors';
import { readValidation, type ValidationIssue } from '../lib/validation-public';
type Draft = {
  stammnummer: string;
  vinChassis: string;
  firstRegistration: string;
  make: string;
  model: string;
  cubicCapacity: string;
  powerKw: string;
  mileage: string;
  canton: string;
  mfkDate: string;
  serviceHistory: string;
  tireCondition: string;
  startPrice: string;
  reservePrice: string;
  description: string;
};
type Photo = { file: File; preview: string; url?: string; expiresAt?: string };
const empty: Draft = {
  stammnummer: '',
  vinChassis: '',
  firstRegistration: '',
  make: '',
  model: '',
  cubicCapacity: '',
  powerKw: '',
  mileage: '',
  canton: 'ZH',
  mfkDate: '',
  serviceHistory: 'FULL',
  tireCondition: '',
  startPrice: '',
  reservePrice: '',
  description: '',
};
const steps = ['stepScan', 'stepVerify', 'stepPhotos', 'stepAuction'] as const;
export function ListingWizard() {
  const { t, money } = useLocale();
  const { status } = useSession();
  const { data } = useResource<{ demo: boolean }>('/api/market');
  const [specs, setSpecs] = useState<Record<string, string>>({});
  const [equipment, setEquipment] = useState<string[]>([]);
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState(empty);
  const [customMake, setCustomMake] = useState(false);
  const [customModel, setCustomModel] = useState(false);
  const [registrationYear, setRegistrationYear] = useState('');
  const [document, setDocument] = useState<File | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<MessageKey | null>(null);
  const [validation, setValidation] = useState<ValidationIssue[]>([]);
  const [consent, setConsent] = useState(false);
  const [success, setSuccess] = useState(false);
  const photoRefs = useRef<Photo[]>([]);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, [step]);
  useEffect(() => {
    photoRefs.current = photos;
  }, [photos]);
  useEffect(
    () => () => {
      photoRefs.current.forEach((p) => URL.revokeObjectURL(p.preview));
    },
    [],
  );
  const update = (key: keyof Draft, value: string) => {
    setValidation([]);
    setDraft((old) => ({ ...old, [key]: value }));
  };
  const today = new Date().toISOString().slice(0, 10);
  function go(next: number) {
    setMessage(null);
    setStep(next);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  async function parse() {
    if (!document) return;
    setBusy(true);
    setMessage(null);
    try {
      const form = new FormData();
      form.set('document', document);
      const r = await fetch('/api/ocr/parse-fahrzeugausweis', { method: 'POST', body: form });
      if (!r.ok) throw new Error();
      const { fields } = await r.json();
      setCustomMake(true);
      setCustomModel(true);
      setRegistrationYear(fields.firstRegistration?.slice(0, 4) ?? '');
      setDraft((old) => ({
        ...old,
        stammnummer: fields.stammnummer ?? '',
        vinChassis: fields.vinChassis ?? '',
        firstRegistration: fields.firstRegistration ?? '',
        make: fields.makeAndModel?.split(' ')[0] ?? '',
        model: fields.makeAndModel?.split(' ').slice(1).join(' ') ?? '',
        cubicCapacity: fields.cubicCapacity ?? '',
        powerKw: fields.powerKw ?? '',
      }));
      setStep(1);
      setMessage('ocrReview');
    } catch {
      setMessage('ocrFailed');
    } finally {
      setBusy(false);
    }
  }
  function addPhotos(files: FileList | null) {
    if (!files) return;
    const picked = Array.from(files);
    if (
      picked.some((f) => !['image/jpeg', 'image/png'].includes(f.type) || f.size > 5_000_000) ||
      photos.length + picked.length > 12
    ) {
      setMessage('invalidPhoto');
      return;
    }
    setMessage(null);
    setPhotos((old) => [
      ...old,
      ...picked.map((file) => ({ file, preview: URL.createObjectURL(file) })),
    ]);
  }
  async function submit() {
    if (!consent || busy || data?.demo) return;
    setBusy(true);
    setMessage(null);
    setValidation([]);
    try {
      const uploaded: Photo[] = [];
      for (const photo of photos) {
        if (photo.url && photo.expiresAt && Date.parse(photo.expiresAt) > Date.now()) {
          uploaded.push(photo);
          continue;
        }
        const form = new FormData();
        form.set('photo', photo.file);
        const response = await fetch('/api/uploads', { method: 'POST', body: form });
        if (!response.ok) {
          const error = await response.json().catch(() => ({}));
          throw new Error(
            error.error === 'PHOTO_QUOTA_EXCEEDED'
              ? 'uploadQuota'
              : error.error === 'PHOTO_BUSY'
                ? 'uploadBusy'
                : error.error === 'INVALID_IMAGE' || error.error === 'PHOTO_TOO_LARGE'
                  ? 'invalidPhoto'
                  : 'submitFailed',
          );
        }
        const result = await response.json();
        photo.url = result.url;
        photo.expiresAt = result.expiresAt;
        uploaded.push(photo);
      }
      setPhotos([...uploaded]);
      const { reservePrice, cubicCapacity, powerKw, ...rest } = draft;
      const payload = {
        ...rest,
        equipment,
        ...Object.fromEntries(
          Object.entries(specs)
            .filter(([, value]) => value !== '')
            .map(([key, value]) => [key, key in specNumbers ? Number(value) : value]),
        ),
        mileage: Number(draft.mileage),
        listingType: 'AUCTION_7_DAYS',
        images: uploaded.map((p) => p.url),
        ...(reservePrice ? { reservePrice } : {}),
        ...(cubicCapacity ? { cubicCapacity: Number(cubicCapacity) } : {}),
        ...(powerKw ? { powerKw: Number(powerKw) } : {}),
      };
      const response = await fetch('/api/vehicles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        setValidation(readValidation(await response.json().catch(() => ({}))));
        throw new Error();
      }
      setSuccess(true);
    } catch (error) {
      setMessage(
        error instanceof Error &&
          ['uploadQuota', 'uploadBusy', 'invalidPhoto'].includes(error.message)
          ? (error.message as MessageKey)
          : 'submitFailed',
      );
    } finally {
      setBusy(false);
    }
  }
  function field(
    key: keyof Draft,
    label: MessageKey,
    type = 'text',
    required = true,
    extra: React.InputHTMLAttributes<HTMLInputElement> = {},
  ) {
    return (
      <label className="form-label" key={key}>
        {t(label)}
        {required && <span className="required-star">*</span>}
        <Input
          value={draft[key]}
          onChange={(e) => update(key, e.target.value)}
          type={type}
          inputMode={
            type === 'number'
              ? extra.step && Number(extra.step) < 1
                ? 'decimal'
                : 'numeric'
              : undefined
          }
          required={required}
          {...extra}
        />
      </label>
    );
  }
  if (success)
    return (
      <div className="container success-page">
        <CheckCircle2 size={60} />
        <h1>{t('listingSuccess')}</h1>
        <p>{t('listingSuccessText')}</p>
        <Button asChild>
          <Link href="/dashboard">
            {t('garage')}
            <ArrowRight size={16} />
          </Link>
        </Button>
      </div>
    );
  return (
    <>
      {data?.demo && <DemoBanner />}
      <div className="container wizard-page">
        <div className="page-heading">
          <p className="eyebrow">AUTOVERI / {t('sell')}</p>
          <h1>{t('wizardTitle')}</h1>
          <p>{t('wizardIntro')}</p>
        </div>
        <ol className="wizard-steps">
          {steps.map((key, i) => (
            <li
              key={key}
              className={i === step ? 'current' : i < step ? 'complete' : ''}
              aria-current={i === step ? 'step' : undefined}
            >
              <span>{i < step ? <Check size={17} /> : i + 1}</span>
              <b>{t(key)}</b>
            </li>
          ))}
        </ol>
        <div className="wizard-layout">
          <section className="panel wizard-form" onInput={() => setValidation([])}>
            <h2 ref={heading} tabIndex={-1}>
              {t(
                step === 0
                  ? 'scanTitle'
                  : step === 1
                    ? 'stepVerify'
                    : step === 2
                      ? 'photosTitle'
                      : 'auctionTitle',
              )}
            </h2>
            <p>
              {t(
                step === 0
                  ? 'scanHint'
                  : step === 1
                    ? 'ocrReview'
                    : step === 2
                      ? 'photosHint'
                      : 'auctionIntro',
              )}
            </p>
            {message && (
              <p className="notice" role="status">
                {t(message)}
              </p>
            )}
            <ValidationErrors issues={validation} />
            {step === 0 && (
              <>
                <label className="upload-zone">
                  <span className="upload-icon">
                    <FileScan size={35} />
                  </span>
                  <strong>{t('chooseDocument')}</strong>
                  <span>{document?.name ?? t('imageLimit')}</span>
                  <input
                    type="file"
                    accept="image/jpeg,image/png"
                    capture="environment"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (
                        file &&
                        ['image/jpeg', 'image/png'].includes(file.type) &&
                        file.size <= 5_000_000
                      ) {
                        setDocument(file);
                        setMessage(null);
                      } else setMessage('invalidPhoto');
                    }}
                  />
                  <span className="upload-button">
                    <Camera size={16} />
                    {t('chooseDocument')}
                  </span>
                </label>
                <div className="wizard-actions">
                  <Button variant="ghost" onClick={() => go(1)}>
                    {t('manual')}
                    <ArrowRight size={15} />
                  </Button>
                  <Button disabled={!document || busy || data?.demo} onClick={() => void parse()}>
                    {busy ? t('loading') : t('parse')}
                  </Button>
                </div>
              </>
            )}
            {step === 1 && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  go(2);
                }}
              >
                <div className="form-grid">
                  <label className="form-label">
                    {t('make')} *
                    <Select
                      className="field"
                      required
                      value={customMake ? '__other' : draft.make}
                      onChange={(e) => {
                        setCustomMake(e.target.value === '__other');
                        setCustomModel(false);
                        setDraft((old) => ({
                          ...old,
                          make: e.target.value === '__other' ? '' : e.target.value,
                          model: '',
                        }));
                      }}
                    >
                      <option value="">{t('selectVehicleOption')}</option>
                      {Object.keys(vehicleCatalog)
                        .sort()
                        .map((make) => (
                          <option key={make}>{make}</option>
                        ))}
                      <option value="__other">{t('manualVehicleOption')}</option>
                    </Select>
                  </label>
                  {customMake && field('make', 'make', 'text', true, { maxLength: 80 })}
                  <label className="form-label">
                    {t('model')} *
                    <Select
                      className="field"
                      required
                      disabled={!draft.make}
                      value={customModel ? '__other' : draft.model}
                      onChange={(e) => {
                        setCustomModel(e.target.value === '__other');
                        update('model', e.target.value === '__other' ? '' : e.target.value);
                      }}
                    >
                      <option value="">{t('selectVehicleOption')}</option>
                      {(vehicleCatalog[draft.make] ?? []).map((model) => (
                        <option key={model}>{model}</option>
                      ))}
                      <option value="__other">{t('manualVehicleOption')}</option>
                    </Select>
                  </label>
                  {customModel && field('model', 'model', 'text', true, { maxLength: 100 })}
                  <label className="form-label">
                    {t('registrationYear')} *
                    <Select
                      className="field"
                      required
                      value={registrationYear}
                      onChange={(e) => {
                        setRegistrationYear(e.target.value);
                        update('firstRegistration', '');
                      }}
                    >
                      <option value="">{t('selectVehicleOption')}</option>
                      {Array.from(
                        { length: new Date().getFullYear() - 1899 },
                        (_, i) => new Date().getFullYear() - i,
                      ).map((year) => (
                        <option key={year}>{year}</option>
                      ))}
                    </Select>
                  </label>
                  <p className="fine-print">{t('vehicleCatalogHint')}</p>
                  {field('stammnummer', 'stammnummer', 'text', true, {
                    pattern: '[0-9]{9}',
                    maxLength: 9,
                    inputMode: 'numeric',
                  })}
                  {field('vinChassis', 'vinFull', 'text', true, {
                    pattern: '[A-HJ-NPR-Z0-9]{17}',
                    maxLength: 17,
                    onChange: (e) => update('vinChassis', e.target.value.toUpperCase()),
                  })}
                  {field('firstRegistration', 'registration', 'date', true, {
                    disabled: !registrationYear,
                    max:
                      registrationYear === today.slice(0, 4) ? today : `${registrationYear}-12-31`,
                    min: `${registrationYear || '1900'}-01-01`,
                  })}
                  {field('mileage', 'mileage', 'number', true, { min: 0, max: 2000000, step: 1 })}
                  {field('cubicCapacity', 'capacity', 'number', false, {
                    min: 1,
                    max: 20000,
                    step: 1,
                  })}
                  {field('powerKw', 'power', 'number', false, { min: 1, max: 3000, step: 1 })}
                  {field('mfkDate', 'inspection', 'date', true, { max: today, min: '1900-01-01' })}
                  <label className="form-label">
                    {t('canton')}
                    <Select
                      className="field"
                      value={draft.canton}
                      onChange={(e) => update('canton', e.target.value)}
                    >
                      {cantons.map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </Select>
                  </label>
                  <label className="form-label">
                    {t('serviceHistory')}
                    <Select
                      className="field"
                      value={draft.serviceHistory}
                      onChange={(e) => update('serviceHistory', e.target.value)}
                    >
                      {(['FULL', 'PARTIAL', 'NONE'] as const).map((s) => (
                        <option value={s} key={s}>
                          {t(s)}
                        </option>
                      ))}
                    </Select>
                  </label>
                  <details
                    className="wizard-optional"
                    onInvalidCapture={(event) => {
                      event.currentTarget.open = true;
                    }}
                  >
                    <summary>{t('optionalVehicleDetails')}</summary>
                    <div className="form-grid mt-4">
                      <SpecFields
                        values={specs}
                        onChange={(key, value) => setSpecs((old) => ({ ...old, [key]: value }))}
                      />
                      <EquipmentFields values={equipment} onChange={setEquipment} />
                    </div>
                  </details>
                  {field('tireCondition', 'tireCondition', 'text', true, { maxLength: 200 })}
                </div>
                <div className="wizard-actions">
                  <Button variant="ghost" type="button" onClick={() => go(0)}>
                    <ArrowLeft size={15} />
                    {t('back')}
                  </Button>
                  <Button type="submit">
                    {t('next')}
                    <ArrowRight size={15} />
                  </Button>
                </div>
              </form>
            )}
            {step === 2 && (
              <>
                <label className="upload-zone compact">
                  <ImagePlus size={34} />
                  <strong>{t('choosePhotos')}</strong>
                  <span>{t('imageLimit')}</span>
                  <input
                    type="file"
                    accept="image/jpeg,image/png"
                    multiple
                    onChange={(e) => {
                      addPhotos(e.target.files);
                      e.target.value = '';
                    }}
                  />
                </label>
                <div className="upload-previews">
                  {photos.map((p, i) => (
                    <div key={p.preview}>
                      <VehicleImage src={p.preview} alt={t('photo', { number: i + 1 })} />
                      {i === 0 && <span className="cover-label">{t('cover')}</span>}
                      <button
                        className="remove-photo"
                        aria-label={`${t('remove')} ${t('photo', { number: i + 1 })}`}
                        onClick={() => {
                          URL.revokeObjectURL(p.preview);
                          setPhotos((old) => old.filter((_, index) => index !== i));
                        }}
                      >
                        <Trash2 size={15} />
                      </button>
                      {i > 0 && (
                        <button
                          className="cover-button"
                          onClick={() =>
                            setPhotos((old) => [old[i], ...old.filter((_, index) => index !== i)])
                          }
                        >
                          {t('makeCover')}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <div className="wizard-actions">
                  <Button variant="ghost" onClick={() => go(1)}>
                    <ArrowLeft size={15} />
                    {t('back')}
                  </Button>
                  <Button onClick={() => (photos.length ? go(3) : setMessage('photosRequired'))}>
                    {t('next')}
                    <ArrowRight size={15} />
                  </Button>
                </div>
              </>
            )}
            {step === 3 && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void submit();
                }}
              >
                <div className="duration-card">
                  <ClockIcon />
                  <div>
                    <b>{t('fairAuctions')}</b>
                    <p>{t('softCloseText')}</p>
                  </div>
                </div>
                <div className="form-grid">
                  {field('startPrice', 'startingPrice', 'number', true, {
                    min: 1,
                    max: 999999999,
                    step: '0.01',
                  })}
                  {field('reservePrice', 'reservePrice', 'number', false, {
                    min: Number(draft.startPrice) || 1,
                    max: 999999999,
                    step: '0.01',
                  })}
                </div>
                <p className="fine-print">{t('reserveHint')}</p>
                <label className="form-label mt-6">
                  {t('description')}
                  <Textarea
                    className="field"
                    rows={5}
                    maxLength={5000}
                    value={draft.description}
                    onChange={(e) => update('description', e.target.value)}
                  />
                </label>
                <label className="check-label mt-6">
                  <input
                    type="checkbox"
                    required
                    checked={consent}
                    onChange={(e) => setConsent(e.target.checked)}
                  />
                  {t('listingConsent')}
                </label>
                {data?.demo ? (
                  <p className="notice mt-4">{t('demoSubmit')}</p>
                ) : status !== 'authenticated' ? (
                  <p className="notice mt-4">
                    <Link href="/login">{t('signInRequired')}</Link>
                  </p>
                ) : null}
                <div className="wizard-actions">
                  <Button type="button" variant="ghost" disabled={busy} onClick={() => go(2)}>
                    <ArrowLeft size={15} />
                    {t('back')}
                  </Button>
                  <Button
                    type="submit"
                    variant="green"
                    disabled={!consent || busy || data?.demo || status !== 'authenticated'}
                  >
                    {busy ? t('loading') : t('submitListing')}
                    <ArrowRight size={15} />
                  </Button>
                </div>
              </form>
            )}
          </section>
          <aside className="wizard-aside">
            <div className="panel">
              <ShieldCheck size={30} />
              <h3>{t('verifiedData')}</h3>
              <p>{t('verifiedRequired')}</p>
              <hr />
              <LockKeyhole size={22} />
              <p>{t('ocrReview')}</p>
            </div>
            {draft.make && (
              <div className="draft-preview">
                <small>{t('vehicle')}</small>
                <h3>
                  {draft.make} {draft.model}
                </h3>
                <p>
                  {draft.mileage ? `${draft.mileage} km · ` : ''}
                  {draft.canton}
                </p>
                {draft.startPrice && <b>{money(Number(draft.startPrice))}</b>}
              </div>
            )}
          </aside>
        </div>
      </div>
    </>
  );
}
function ClockIcon() {
  return <span className="duration-icon">7</span>;
}
