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
  city: string;
  postalCode: string;
  mfkDate: string;
  mfkStatus: string;
  modelYear: string;
  damageDescription: string;
  serviceHistory: string;
  tireCondition: string;
  startPrice: string;
  reservePrice: string;
  buyNowPrice: string;
  description: string;
};
type Photo = { file?: File; attached?: boolean; preview: string; url?: string; expiresAt?: string };
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
  city: '',
  postalCode: '',
  mfkDate: '',
  mfkStatus: 'UNKNOWN',
  modelYear: '',
  damageDescription: '',
  serviceHistory: 'FULL',
  tireCondition: '',
  startPrice: '',
  reservePrice: '',
  buyNowPrice: '',
  description: '',
};
const steps = ['stepScan', 'stepVerify', 'stepPhotos', 'stepAuction'] as const;
export function ListingWizard() {
  const { t, money, locale } = useLocale();
  const { status } = useSession();
  const { data } = useResource<{ demo: boolean }>('/api/market');
  const draftId = useRef('');
  const [revision, setRevision] = useState(0);
  const [savedAt, setSavedAt] = useState('');
  const [restoring, setRestoring] = useState(true);
  const [restoreFailed, setRestoreFailed] = useState(false);
  const [preview, setPreview] = useState(false);
  const [listingType, setListingType] = useState<'AUCTION_7_DAYS' | 'FIXED_PRICE_OFFERS'>(
    'AUCTION_7_DAYS',
  );
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

  useEffect(() => {
    const controller = new AbortController();
    const id = new URLSearchParams(window.location.search).get('draft');
    if (!id) {
      setRestoring(false);
      return;
    }
    void (async () => {
      try {
        const r = await fetch('/api/listing-drafts?id=' + encodeURIComponent(id), {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!r.ok) throw Error();
        const row = await r.json();
        if (controller.signal.aborted) return;
        draftId.current = row.id;
        setRevision(row.revision);
        setSavedAt(row.updatedAt);
        const p = row.payload;
        setDraft({
          ...empty,
          ...p.draft,
          mfkStatus: p.draft.mfkStatus || (p.draft.mfkDate ? 'DATED' : 'UNKNOWN'),
        });
        setSpecs(p.specs);
        setEquipment(p.equipment);
        setStep(row.step);
        setListingType(p.listingType);
        setCustomMake(p.customMake);
        setCustomModel(p.customModel);
        setRegistrationYear(p.registrationYear);
        setPhotos(p.images.map((url: string) => ({ url, preview: url, attached: true })));
        setConsent(false);
      } catch {
        if (!controller.signal.aborted) setRestoreFailed(true);
      } finally {
        if (!controller.signal.aborted) setRestoring(false);
      }
    })();
    return () => controller.abort();
  }, []);
  function draftError(error: unknown) {
    const code = error instanceof Error ? error.message : '';
    const keys: Record<string, MessageKey> = {
      DRAFT_CONFLICT: 'draftConflict',
      DRAFT_LOCKED: 'draftLocked',
      DRAFT_QUOTA: 'draftQuota',
      PHOTO_OWNERSHIP_REQUIRED: 'draftPhotoError',
      DRAFT_PRICE: 'draftPriceError',
      VERIFICATION_REQUIRED: 'verifiedRequired',
      PHOTO_QUOTA_EXCEEDED: 'uploadQuota',
      PHOTO_BUSY: 'uploadBusy',
    };
    setMessage(keys[code] ?? 'draftFailed');
  }
  async function saveRecord() {
    const uploaded: Photo[] = [];
    for (const photo of photos) {
      if (
        photo.url &&
        (photo.attached || (photo.expiresAt && Date.parse(photo.expiresAt) > Date.now()))
      ) {
        uploaded.push(photo);
        continue;
      }
      if (!photo.file) throw Error('PHOTO_OWNERSHIP_REQUIRED');
      const form = new FormData();
      form.set('photo', photo.file);
      const r = await fetch('/api/uploads', { method: 'POST', body: form });
      const result = await r.json();
      if (!r.ok) throw Error(result.error);
      photo.url = result.url;
      photo.expiresAt = result.expiresAt;
      uploaded.push(photo);
    }
    setPhotos([...uploaded]);
    draftId.current ||= crypto.randomUUID();
    const payload = {
      draft,
      specs,
      equipment,
      images: uploaded.map((p) => p.url),
      customMake,
      customModel,
      registrationYear,
      listingType,
    };
    const r = await fetch('/api/listing-drafts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'save', id: draftId.current, revision, step, payload }),
    });
    const row = await r.json();
    if (!r.ok) {
      setValidation(readValidation(row));
      throw Error(row.error);
    }
    setRevision(row.revision);
    setSavedAt(row.updatedAt);
    setPhotos(uploaded.map((p) => ({ ...p, attached: true })));
    window.history.replaceState(window.history.state, '', '/sell?draft=' + row.id);
    return row;
  }
  async function saveDraft() {
    if (busy || restoring) return;
    setBusy(true);
    setMessage(null);
    setValidation([]);
    try {
      await saveRecord();
      setMessage('draftSaved');
    } catch (e) {
      draftError(e);
    } finally {
      setBusy(false);
    }
  }

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
    if (!consent || busy || restoring || data?.demo) return;
    setBusy(true);
    setMessage(null);
    setValidation([]);
    try {
      const row = await saveRecord();
      const r = await fetch('/api/listing-drafts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'submit',
          id: row.id,
          revision: row.revision,
          consent: true,
        }),
      });
      const result = await r.json();
      if (!r.ok) {
        setValidation(readValidation(result));
        throw Error(result.error);
      }
      setSuccess(true);
    } catch (e) {
      draftError(e);
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
  if (restoring)
    return (
      <div className="container wizard-page">
        <p role="status">{t('loading')}</p>
      </div>
    );
  if (restoreFailed)
    return (
      <div className="container wizard-page">
        <p role="alert">{t('draftFailed')}</p>
        <Link href="/drafts">{t('draftsTitle')}</Link>
      </div>
    );
  if (preview) {
    const labels: Record<keyof Draft, MessageKey> = {
      make: 'make',
      model: 'model',
      stammnummer: 'stammnummer',
      vinChassis: 'vinFull',
      firstRegistration: 'registration',
      cubicCapacity: 'capacity',
      powerKw: 'power',
      mileage: 'mileage',
      canton: 'canton',
      city: 'locationCity',
      postalCode: 'locationPostalCode',
      mfkDate: 'inspection',
      mfkStatus: 'mfkStatus',
      modelYear: 'modelYear',
      damageDescription: 'damageDescription',
      serviceHistory: 'serviceHistory',
      tireCondition: 'tireCondition',
      startPrice: 'startingPrice',
      reservePrice: 'reservePrice',
      buyNowPrice: 'draftBuyNow',
      description: 'description',
    };
    return (
      <section className="container drafts-page">
        <h1>{t('draftPreview')}</h1>
        <p className="notice">{t('draftPreviewHint')}</p>
        <Button onClick={() => setPreview(false)}>{t('draftBack')}</Button>
        <h2>
          {draft.make || t('draftUntitled')} {draft.model}
        </h2>
        <p>{t(listingType === 'AUCTION_7_DAYS' ? 'draftAuction' : 'draftFixed')}</p>
        <div className="draft-photo-grid">
          {photos.map((p, i) => (
            <VehicleImage key={p.preview} src={p.preview} alt={t('photo', { number: i + 1 })} />
          ))}
        </div>
        <dl className="spec-grid">
          {Object.entries(draft).map(([k, v]) => (
            <div key={k}>
              <dt>{t(labels[k as keyof Draft])}</dt>
              <dd>
                {k === 'mfkStatus'
                  ? t(v === 'DATED' ? 'mfkDated' : v === 'NEVER' ? 'mfkNever' : 'mfkUnknown')
                  : v
                    ? k === 'serviceHistory'
                      ? t(v as MessageKey)
                      : v
                    : t('notProvided')}
              </dd>
            </div>
          ))}
          {Object.entries(specs).map(([k, v]) => (
            <div key={k}>
              <dt>{t(k as MessageKey)}</dt>
              <dd>{v ? (k in specNumbers ? v : t(v as MessageKey)) : t('notProvided')}</dd>
            </div>
          ))}
          <div>
            <dt>{t('equipment')}</dt>
            <dd>
              {equipment.length
                ? equipment.map((e) => t(e as MessageKey)).join(', ')
                : t('notProvided')}
            </dd>
          </div>
        </dl>
        <Button onClick={() => setPreview(false)}>{t('draftBack')}</Button>
      </section>
    );
  }
  if (success)
    return (
      <div className="container success-page">
        <CheckCircle2 size={60} />
        <h1>{t('listingSuccess')}</h1>
        <p>{t(listingType === 'AUCTION_7_DAYS' ? 'listingSuccessText' : 'listingSuccess')}</p>
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
        <div className="draft-toolbar">
          <Link href="/drafts">{t('draftsTitle')}</Link>
          <Button variant="outline" disabled={busy || data?.demo} onClick={() => void saveDraft()}>
            {t('draftSave')}
          </Button>
          <Button variant="outline" disabled={busy} onClick={() => setPreview(true)}>
            {t('draftPreview')}
          </Button>
          <p>{t('draftManualSave')}</p>
          {savedAt && (
            <p>
              {t('draftSavedAt')}{' '}
              {new Date(savedAt).toLocaleString(`${locale}-CH`, { timeZone: 'Europe/Zurich' })}
            </p>
          )}
        </div>
        <ol className="wizard-steps">
          {steps.map((key, i) => (
            <li
              key={key}
              className={i === step ? 'current' : i < step ? 'complete' : ''}
              aria-current={i === step ? 'step' : undefined}
            >
              <span>{i < step ? <Check size={17} /> : i + 1}</span>
              <b>{t(i === 3 && listingType === 'FIXED_PRICE_OFFERS' ? 'draftListingType' : key)}</b>
            </li>
          ))}
        </ol>
        <div className="wizard-layout">
          <section className="panel wizard-form" onInput={() => setValidation([])}>
            <fieldset disabled={busy} className="draft-fieldset">
              <h2 ref={heading} tabIndex={-1}>
                {t(
                  step === 0
                    ? 'scanTitle'
                    : step === 1
                      ? 'stepVerify'
                      : step === 2
                        ? 'photosTitle'
                        : listingType === 'AUCTION_7_DAYS'
                          ? 'auctionTitle'
                          : 'draftListingType',
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
                        : listingType === 'AUCTION_7_DAYS'
                          ? 'auctionIntro'
                          : 'draftFixed',
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
                    <p className="notice md:col-span-2">{t('dataOriginWizard')}</p>
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
                        registrationYear === today.slice(0, 4)
                          ? today
                          : `${registrationYear}-12-31`,
                      min: `${registrationYear || '1900'}-01-01`,
                    })}
                    {field('modelYear', 'modelYear', 'number', false, {
                      min: 1900,
                      max: new Date().getFullYear() + 1,
                      step: 1,
                    })}
                    <p className="fine-print">{t('modelYearHint')}</p>
                    {field('mileage', 'mileage', 'number', true, { min: 0, max: 2000000, step: 1 })}
                    {field('cubicCapacity', 'capacity', 'number', false, {
                      min: 1,
                      max: 20000,
                      step: 1,
                    })}
                    {field('powerKw', 'power', 'number', false, { min: 1, max: 3000, step: 1 })}
                    <label className="form-label">
                      {t('mfkStatus')}
                      <Select
                        value={draft.mfkStatus}
                        onChange={(e) => {
                          update('mfkStatus', e.target.value);
                          if (e.target.value !== 'DATED') update('mfkDate', '');
                        }}
                      >
                        <option value="UNKNOWN">{t('mfkUnknown')}</option>
                        <option value="NEVER">{t('mfkNever')}</option>
                        <option value="DATED">{t('mfkDated')}</option>
                      </Select>
                    </label>
                    {draft.mfkStatus === 'DATED' &&
                      field('mfkDate', 'inspection', 'date', true, {
                        max: today,
                        min: '1900-01-01',
                      })}
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
                    {field('city', 'locationCity', 'text', false, {
                      maxLength: 80,
                      autoComplete: 'address-level2',
                      'aria-describedby': 'location-privacy-hint',
                    })}
                    {field('postalCode', 'locationPostalCode', 'text', false, {
                      maxLength: 4,
                      inputMode: 'numeric',
                      pattern: '[1-9][0-9]{3}',
                      autoComplete: 'postal-code',
                      'aria-describedby': 'location-privacy-hint',
                    })}
                    <p id="location-privacy-hint" className="fine-print">
                      {t('locationPrivacyHint')}
                    </p>
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
                        <label className="form-label">
                          {t('damageDescription')}
                          <Textarea
                            value={draft.damageDescription}
                            maxLength={2000}
                            required={['DAMAGED', 'REPAIRED'].includes(specs.accidentHistory)}
                            onChange={(e) => update('damageDescription', e.target.value)}
                          />
                        </label>
                        <p className="fine-print">{t('disclosureHint')}</p>
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
                  <label className="form-label">
                    {t('draftListingType')}
                    <Select
                      value={listingType}
                      onChange={(e) => setListingType(e.target.value as typeof listingType)}
                    >
                      <option value="AUCTION_7_DAYS">{t('draftAuction')}</option>
                      <option value="FIXED_PRICE_OFFERS">{t('draftFixed')}</option>
                    </Select>
                  </label>
                  {listingType === 'FIXED_PRICE_OFFERS' &&
                    field('buyNowPrice', 'draftBuyNow', 'number', true, {
                      min: 1,
                      max: 999999999,
                      step: '0.01',
                    })}
                  {listingType === 'AUCTION_7_DAYS' && (
                    <div className="duration-card">
                      <ClockIcon />
                      <div>
                        <b>{t('fairAuctions')}</b>
                        <p>{t('softCloseText')}</p>
                      </div>
                    </div>
                  )}
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
            </fieldset>
          </section>
          <aside className="wizard-aside">
            <div className="panel">
              <ShieldCheck size={30} />
              <h3>{t('dataOriginTitle')}</h3>
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
                  {[draft.postalCode, draft.city, draft.canton].filter(Boolean).join(' ')}
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
