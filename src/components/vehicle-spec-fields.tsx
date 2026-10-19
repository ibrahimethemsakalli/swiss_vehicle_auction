'use client';
import { Select } from './ui/form-controls';
import {
  specOptions,
  specNumbers,
  equipmentOptions,
  type VehicleSpecs,
} from '../lib/vehicle-specs';
import { useLocale, type MessageKey } from './providers';

export function EquipmentFields({
  values,
  onChange,
}: {
  values: string[];
  onChange: (next: string[]) => void;
}) {
  const { t } = useLocale();
  return (
    <fieldset className="advanced-fields">
      <legend>{t('equipment')}</legend>
      {equipmentOptions.map((value) => (
        <label className="check-label" key={value}>
          <input
            type="checkbox"
            checked={values.includes(value)}
            onChange={(e) =>
              onChange(e.target.checked ? [...values, value] : values.filter((v) => v !== value))
            }
          />
          {t(value)}
        </label>
      ))}
    </fieldset>
  );
}
export function SpecFields({
  values,
  onChange,
}: {
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
}) {
  const { t } = useLocale();
  return (
    <>
      {Object.entries(specOptions).map(([key, options]) => (
        <label className="form-label" key={key}>
          {t(key as MessageKey)}
          <Select
            className="field"
            value={values[key] ?? ''}
            onChange={(e) => onChange(key, e.target.value)}
          >
            <option value="">{t('notProvided')}</option>
            {options.map((value) => (
              <option key={value} value={value}>
                {t(value as MessageKey)}
              </option>
            ))}
          </Select>
        </label>
      ))}
      {Object.entries(specNumbers).map(([key, [min, max, step, unit]]) => (
        <label className="form-label" key={key}>
          {t(key as MessageKey)} {unit}
          <input
            className="field"
            type="number"
            inputMode={step < 1 ? 'decimal' : 'numeric'}
            min={min}
            max={max}
            step={step}
            value={values[key] ?? ''}
            onChange={(e) => onChange(key, e.target.value)}
          />
        </label>
      ))}
    </>
  );
}

export function SpecDetails({ vehicle }: { vehicle: VehicleSpecs & { isSample?: boolean } }) {
  const { t, number } = useLocale();
  return (
    <dl className="spec-grid">
      <div>
        <dt>{t('equipment')}</dt>
        <dd>
          {vehicle.equipment?.length
            ? vehicle.equipment.map((value) => t(value as MessageKey)).join(', ')
            : t(vehicle.isSample ? 'unverified' : 'notProvided')}
        </dd>
      </div>
      {Object.keys(specOptions).map((key) => (
        <div key={key}>
          <dt>{t(key as MessageKey)}</dt>
          <dd>
            {vehicle[key as keyof VehicleSpecs] == null
              ? t(vehicle.isSample ? 'unverified' : 'notProvided')
              : t(vehicle[key as keyof VehicleSpecs] as MessageKey)}
          </dd>
        </div>
      ))}
      {Object.entries(specNumbers).map(([key, [, , , unit]]) => (
        <div key={key}>
          <dt>{t(key as MessageKey)}</dt>
          <dd>
            {vehicle[key as keyof VehicleSpecs] == null
              ? t(vehicle.isSample ? 'unverified' : 'notProvided')
              : `${number(vehicle[key as keyof VehicleSpecs] as number)} ${unit}`}
          </dd>
        </div>
      ))}
    </dl>
  );
}
