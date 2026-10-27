import { z } from 'zod';
import { validationFields, validationKeys, type ValidationIssue } from './validation-public';

export function publicValidation(error: unknown): ValidationIssue[] {
  if (!(error instanceof z.ZodError)) return [];
  return error.issues.slice(0, 10).map((issue) => {
    const root = issue.path[0];
    const field =
      typeof root === 'string' && Object.hasOwn(validationFields, root)
        ? (root as ValidationIssue['field'])
        : 'form';
    let key: ValidationIssue['key'] = 'validationInvalid',
      values: Record<string, number> | undefined;
    if (validationKeys.includes(issue.message as ValidationIssue['key']))
      key = issue.message as ValidationIssue['key'];
    else if (issue.code === 'too_small' || issue.code === 'too_big') {
      const small = issue.code === 'too_small';
      const value = Number(small ? issue.minimum : issue.maximum);
      if (issue.origin === 'string') {
        key = small ? 'validationMinLength' : 'validationMaxLength';
        values = { count: value };
      } else if (issue.origin === 'array') {
        key = small ? 'validationMinItems' : 'validationMaxItems';
        values = { count: value };
      } else {
        key =
          issue.inclusive === false
            ? small
              ? 'validationMoreThan'
              : 'validationLessThan'
            : small
              ? 'validationMin'
              : 'validationMax';
        values = { value };
      }
    } else if (issue.code === 'invalid_type' && issue.expected === 'int') key = 'validationInteger';
    else if (issue.code === 'invalid_value') key = 'validationChoice';
    else if (issue.code === 'invalid_format')
      key =
        issue.format === 'email'
          ? 'validationEmail'
          : field === 'phone'
            ? 'validationPhone'
            : issue.format === 'date' || issue.format === 'datetime'
              ? 'validationDate'
              : 'validationInvalid';
    return { field, key, ...(values ? { values } : {}) };
  });
}
