'use client';
import { ValidationErrors } from '../../../components/validation-errors';
import { useEffect, useState } from 'react';
export function ValidationPreview() {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  return (
    <div className="login-page">
      <section className="panel login-card" data-hydrated={ready}>
        <h1>PM-07B validation fixture</h1>
        <p>Display only — no submission or account changes.</p>
        <ValidationErrors
          issues={[
            { field: 'phone', key: 'validationPhone' },
            { field: 'companyName', key: 'validationRequired' },
            { field: 'password', key: 'validationPasswordBytes' },
            { field: 'firstRegistration', key: 'validationDate' },
            { field: 'mfkDate', key: 'validationPastDate' },
            { field: 'serviceHistory', key: 'validationChoice' },
            { field: 'description', key: 'validationMaxLength', values: { count: 5000 } },
            { field: 'images', key: 'validationMaxItems', values: { count: 12 } },
          ]}
        />
      </section>
    </div>
  );
}
