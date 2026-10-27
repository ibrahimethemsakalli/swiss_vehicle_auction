import type en from '../messages/en.json';
type MessageKey = keyof typeof en;
export const validationFields = {
  form: 'validationForm',
  email: 'email',
  password: 'password',
  currentPassword: 'currentPassword',
  phone: 'phone',
  companyName: 'companyName',
  handelsregisterNr: 'companyRegister',
  make: 'make',
  model: 'model',
  mileage: 'mileage',
  canton: 'canton',
  stammnummer: 'stammnummer',
  vinChassis: 'vinFull',
  firstRegistration: 'registration',
  mfkDate: 'inspection',
  images: 'photos',
  description: 'description',
  tireCondition: 'tireCondition',
  serviceHistory: 'serviceHistory',
  equipment: 'equipment',
  startPrice: 'startingPrice',
  reservePrice: 'reservePrice',
  fuelConsumption: 'fuelConsumption',
  amount: 'amount',
  note: 'reviewNote',
  message: 'disputeMessage',
  specs: 'filters',
  ranges: 'filters',
  code: 'smsCode',
} as const satisfies Record<string, MessageKey>;
export const validationKeys = [
  'validationInvalid',
  'validationRequired',
  'validationEmail',
  'validationPhone',
  'validationMinLength',
  'validationMaxLength',
  'validationMin',
  'validationMax',
  'validationMoreThan',
  'validationLessThan',
  'validationPasswordBytes',
  'validationPastDate',
  'validationDate',
  'validationChoice',
  'validationMaxItems',
  'validationMinItems',
  'validationUnique',
  'validationInteger',
] as const;
export type ValidationIssue = {
  field: keyof typeof validationFields;
  key: (typeof validationKeys)[number];
  values?: Record<string, number>;
};
export function readValidation(body: unknown): ValidationIssue[] {
  if (
    !body ||
    typeof body !== 'object' ||
    !('validation' in body) ||
    !Array.isArray(body.validation)
  )
    return [];
  return body.validation.slice(0, 10).flatMap((issue) => {
    if (
      !issue ||
      typeof issue !== 'object' ||
      typeof issue.field !== 'string' ||
      typeof issue.key !== 'string' ||
      !Object.hasOwn(validationFields, issue.field) ||
      !validationKeys.includes(issue.key)
    )
      return [];
    const values: Record<string, number> = {};
    for (const key of ['count', 'value'])
      if (
        Number.isFinite(issue.values?.[key]) &&
        issue.values[key] >= 0 &&
        issue.values[key] <= Number.MAX_SAFE_INTEGER
      )
        values[key] = issue.values[key];
    if (
      (/Length$|Items$/.test(issue.key) && values.count === undefined) ||
      (['validationMin', 'validationMax', 'validationMoreThan', 'validationLessThan'].includes(
        issue.key,
      ) &&
        values.value === undefined)
    )
      return [];
    return [
      { field: issue.field, key: issue.key, ...(Object.keys(values).length ? { values } : {}) },
    ];
  });
}
