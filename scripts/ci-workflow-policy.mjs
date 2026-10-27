import { readFileSync } from 'node:fs';
import { parseDocument } from 'yaml';

export function loadYaml(path) {
  const parsed = parseDocument(readFileSync(path, 'utf8'), { uniqueKeys: true });
  if (parsed.errors.length) throw new Error('INVALID_CI_YAML');
  return parsed.toJS();
}
export function validateWorkflow(workflow) {
  if (JSON.stringify(workflow.permissions) !== JSON.stringify({ contents: 'read' }))
    throw new Error('CI_PERMISSIONS_MUST_BE_READ_ONLY');
  if (
    !workflow.on ||
    Object.keys(workflow.on).some(
      (event) => !['pull_request', 'push', 'workflow_dispatch'].includes(event),
    )
  )
    throw new Error('UNSAFE_CI_TRIGGER');
  if (!workflow.on.pull_request && workflow.on.pull_request !== null)
    throw new Error('PR_CHECK_REQUIRED');
  if (!workflow.concurrency?.['cancel-in-progress']) throw new Error('CI_CONCURRENCY_REQUIRED');
  for (const job of Object.values(workflow.jobs ?? {})) {
    if (job['continue-on-error'] || job.permissions || !job['timeout-minutes'])
      throw new Error('UNSAFE_CI_JOB');
    for (const step of job.steps ?? []) {
      if (step['continue-on-error']) throw new Error('CI_FAILURE_MUST_BLOCK');
      if (step.uses && !/^[a-zA-Z0-9_/-]+@[a-f0-9]{40}$/.test(step.uses))
        throw new Error('ACTION_SHA_REQUIRED');
      if (
        step.uses?.startsWith('actions/checkout@') &&
        step.with?.['persist-credentials'] !== false
      )
        throw new Error('PERSISTED_CREDENTIALS_FORBIDDEN');
      if (
        JSON.stringify(step).includes('secrets.') ||
        /github\.event\.(issue|comment|pull_request)/.test(step.run ?? '')
      )
        throw new Error('UNTRUSTED_CI_INPUT');
    }
  }
  for (const check of ['typecheck', 'unit', 'build'])
    if (!workflow.jobs?.quality?.strategy?.matrix?.check?.includes(check))
      throw new Error('MISSING_QUALITY_CHECK');
  if (!workflow.jobs?.security?.steps?.some((step) => step.run === 'pnpm audit --audit-level high'))
    throw new Error('AUDIT_GATE_REQUIRED');
  if (!workflow.jobs?.['database-schema']?.services?.postgres)
    throw new Error('ISOLATED_POSTGRES_REQUIRED');
}
