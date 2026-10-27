'use client';
import { useLocale } from './providers';
import { validationFields, type ValidationIssue } from '../lib/validation-public';
export function ValidationErrors({ issues }: { issues: ValidationIssue[] }) {
  const { t } = useLocale();
  if (!issues.length) return null;
  return (
    <div className="notice" role="alert" style={{ overflowWrap: 'anywhere', minWidth: 0 }}>
      <strong>{t('validationSummary')}</strong>
      <ul className="list-disc pl-5 mt-2">
        {issues.map((issue, index) => (
          <li key={index}>
            {t(validationFields[issue.field])}: {t(issue.key, issue.values)}
          </li>
        ))}
      </ul>
    </div>
  );
}
