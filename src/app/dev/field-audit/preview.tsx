'use client';
import { useState } from 'react';
import { Select, Textarea } from '../../../components/ui/form-controls';
import { useLocale } from '../../../components/providers';
import { Button } from '../../../components/ui/button';

// Local UI fixture: native validity is exercised, but no API is called.
export function FieldAudit() {
  const { t } = useLocale();
  const [action, setAction] = useState('');
  const [note, setNote] = useState('');
  const [submitted, setSubmitted] = useState(false);
  return (
    <div className="container dashboard-page">
      <p>Local select / textarea validation fixture</p>
      <section className="panel management-panel">
        <form
          className="management-record"
          onSubmit={(e) => {
            e.preventDefault();
            setSubmitted(true);
          }}
        >
          <label className="form-label">
            {t('settlementAction')}
            <Select
              className="field"
              name="action"
              required
              value={action}
              onChange={(e) => setAction(e.target.value)}
            >
              <option value="">{t('chooseAction')}</option>
              <option value="test">{t('MANUAL_RESOLUTION')}</option>
            </Select>
          </label>
          <label className="form-label">
            {t('settlementReason')}
            <Textarea
              className="field"
              name="note"
              required
              minLength={20}
              maxLength={80}
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              aria-describedby="audit-note-help"
            />
            <small id="audit-note-help">20–80</small>
          </label>
          <label className="form-label">
            {t('disputeCategory')}
            <Select className="field" name="category" required defaultValue="">
              <option value="">{t('chooseAction')}</option>
              <option value="test">{t('OTHER')}</option>
            </Select>
          </label>
          <label className="form-label">
            {t('disputeMessage')}
            <Textarea
              className="field"
              name="message"
              required
              minLength={20}
              maxLength={80}
              rows={3}
            />
          </label>
          <Button type="submit" className="mt-3">
            {t('saveDecision')}
          </Button>
        </form>
        <output data-testid="fixture-submit">
          {submitted ? 'VALID — local fixture only' : 'NOT SUBMITTED'}
        </output>
      </section>
    </div>
  );
}
