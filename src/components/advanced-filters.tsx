'use client';
import { specOptions, specNumbers } from '../lib/vehicle-specs';
import type { Filters } from '../lib/market-types';
import { useLocale, type MessageKey } from './providers';
import { EquipmentFields } from './vehicle-spec-fields';
export function AdvancedFilters({
  filters,
  change,
  catalog,
}: {
  filters: Filters;
  change: (next: Filters) => void;
  catalog: { make: string; model: string }[];
}) {
  const { t } = useLocale();
  const range = (
    label: MessageKey,
    min: number | undefined,
    max: number | undefined,
    set: (min: number | undefined, max: number | undefined) => void,
    unit = '',
    step = 1,
  ) => (
    <div className="form-label" key={label}>
      {t(label)} {unit}
      <div className="filter-range">
        <input
          className="field"
          type="number"
          inputMode={step < 1 ? 'decimal' : 'numeric'}
          min="0"
          step={step}
          aria-label={`${t(label)} ${t('from')}`}
          placeholder={t('from')}
          value={min ?? ''}
          onChange={(e) => set(e.target.value === '' ? undefined : Number(e.target.value), max)}
        />
        <input
          className="field"
          type="number"
          inputMode={step < 1 ? 'decimal' : 'numeric'}
          min="0"
          step={step}
          aria-label={`${t(label)} ${t('to')}`}
          placeholder={t('to')}
          value={max ?? ''}
          onChange={(e) => set(min, e.target.value === '' ? undefined : Number(e.target.value))}
        />
      </div>
    </div>
  );
  return (
    <div className="advanced-fields">
      <label className="form-label">
        {t('make')}
        <select
          className="field"
          value={filters.make ?? ''}
          onChange={(e) => change({ ...filters, make: e.target.value, model: '' })}
        >
          <option value="">{t('all')}</option>
          {[...new Set(catalog.map((v) => v.make))].sort().map((make) => (
            <option key={make}>{make}</option>
          ))}
        </select>
      </label>
      <label className="form-label">
        {t('model')}
        <select
          className="field"
          disabled={!filters.make}
          value={filters.model ?? ''}
          onChange={(e) => change({ ...filters, model: e.target.value })}
        >
          <option value="">{t('all')}</option>
          {[...new Set(catalog.filter((v) => v.make === filters.make).map((v) => v.model))]
            .sort()
            .map((model) => (
              <option key={model}>{model}</option>
            ))}
        </select>
      </label>
      {range('year', filters.yearFrom, filters.yearTo, (yearFrom, yearTo) =>
        change({ ...filters, yearFrom, yearTo }),
      )}
      {range(
        'price',
        filters.minPrice,
        filters.price < Number.MAX_SAFE_INTEGER ? filters.price : undefined,
        (minPrice, price) =>
          change({ ...filters, minPrice, price: price ?? Number.MAX_SAFE_INTEGER }),
        'CHF',
      )}
      {range(
        'mileage',
        filters.minMileage,
        filters.mileage < Number.MAX_SAFE_INTEGER ? filters.mileage : undefined,
        (minMileage, mileage) =>
          change({ ...filters, minMileage, mileage: mileage ?? Number.MAX_SAFE_INTEGER }),
        'km',
      )}
      <details>
        <summary>{t('advancedFilters')}</summary>
        <div className="advanced-fields">
          {Object.entries(specOptions)
            .sort(([a], [b]) => {
              const priority: Record<string, number> = {
                fuelType: 0,
                transmission: 1,
                bodyType: 2,
                drivetrain: 3,
              };
              return (priority[a] ?? 4) - (priority[b] ?? 4);
            })
            .map(([key, options]) => (
              <label className="form-label" key={key}>
                {t(key as MessageKey)}
                <select
                  className="field"
                  value={filters.specs?.[key] ?? ''}
                  onChange={(e) =>
                    change({ ...filters, specs: { ...filters.specs, [key]: e.target.value } })
                  }
                >
                  <option value="">{t('all')}</option>
                  {options.map((option) => (
                    <option value={option} key={option}>
                      {t(option as MessageKey)}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          {Object.entries({
            ...specNumbers,
            powerKw: [0, 3000, 1, 'kW'],
            cubicCapacity: [0, 20000, 1, 'cm³'],
          } as Record<string, readonly [number, number, number, string]>).map(
            ([key, [, , step, unit]]) =>
              range(
                key === 'powerKw'
                  ? 'power'
                  : key === 'cubicCapacity'
                    ? 'capacity'
                    : (key as MessageKey),
                filters.ranges?.[key]?.min,
                filters.ranges?.[key]?.max,
                (min, max) =>
                  change({ ...filters, ranges: { ...filters.ranges, [key]: { min, max } } }),
                unit,
                step,
              ),
          )}
          <details>
            <summary>{t('equipment')}</summary>
            <EquipmentFields
              values={filters.equipment ?? []}
              onChange={(equipment) => change({ ...filters, equipment })}
            />
          </details>
        </div>
      </details>
    </div>
  );
}
