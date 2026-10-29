// No network, secrets or operator assumptions in this report.
export type LaunchEnv = Record<string, string | undefined>;
export const localLaunchFlags = [
  'LOCAL_TEST_PAYMENTS',
  'LOCAL_TEST_MESSAGES',
  'LOCAL_PROXY_ENGINE',
  'LOCAL_REFUND_POLICY_WORKER',
] as const;
export function publicOrigin(value: string | undefined) {
  try {
    const u = new URL(value ?? '');
    if (
      u.protocol !== 'https:' ||
      u.username ||
      u.password ||
      u.port ||
      u.pathname !== '/' ||
      u.search ||
      u.hash ||
      !u.hostname.includes('.') ||
      /(?:\.(?:test|local|localhost|invalid|example)$|^localhost$|^\[|^[\d.]+$)/i.test(u.hostname)
    )
      return;
    return u.origin;
  } catch {
    return;
  }
}
export function launchEnvironmentIssues(env: LaunchEnv): string[] {
  const issues: string[] = [];
  for (const key of localLaunchFlags) if (env[key] !== 'false') issues.push(`${key}_MUST_BE_FALSE`);
  if (!['public', 'preview'].includes(env.LAUNCH_MODE ?? '')) issues.push('LAUNCH_MODE_REQUIRED');
  if (env.LAUNCH_MODE === 'preview') {
    if (!['127.0.0.1', 'localhost', '::1'].includes(env.HOST ?? ''))
      issues.push('PREVIEW_LOOPBACK_REQUIRED');
    try {
      if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(env.NEXTAUTH_URL ?? '').hostname))
        issues.push('PREVIEW_AUTH_LOOPBACK_REQUIRED');
    } catch {
      issues.push('PREVIEW_AUTH_LOOPBACK_REQUIRED');
    }
    if (env.BACKGROUND_WORKERS_ENABLED !== 'false') issues.push('PREVIEW_WORKERS_MUST_BE_OFF');
    if (env.SEO_INDEXING_ENABLED !== 'false') issues.push('PREVIEW_INDEXING_MUST_BE_OFF');
    if (
      Object.entries(env).some(
        ([k, v]) =>
          !!v &&
          k !== 'STRIPE_ALLOW_LIVE' &&
          /^(STRIPE_|TWILIO_|SMTP_|EMAIL_SERVER|DATATRANS_)/.test(k),
      )
    )
      issues.push('PREVIEW_PROVIDER_SECRETS_FORBIDDEN');
    if (env.STRIPE_ALLOW_LIVE === 'true') issues.push('PREVIEW_LIVE_PAYMENTS_FORBIDDEN');
    return issues;
  }
  const origin = publicOrigin(env.PUBLIC_SITE_URL);
  if (!origin) issues.push('PUBLIC_HTTPS_ORIGIN_REQUIRED');
  if (!origin || publicOrigin(env.NEXTAUTH_URL) !== origin) issues.push('AUTH_ORIGIN_MISMATCH');
  if (
    !env.NEXTAUTH_SECRET ||
    env.NEXTAUTH_SECRET.length < 32 ||
    /replace|placeholder|ci-only/i.test(env.NEXTAUTH_SECRET)
  )
    issues.push('AUTH_SECRET_REQUIRED');
  if (!env.LAUNCH_LEGAL_VERSION?.trim() || /draft/i.test(env.LAUNCH_LEGAL_VERSION))
    issues.push('PUBLISHED_LEGAL_VERSION_REQUIRED');
  if (!['true', 'false'].includes(env.SEO_INDEXING_ENABLED ?? ''))
    issues.push('INDEXING_SETTING_REQUIRED');
  try {
    if (!['postgres:', 'postgresql:'].includes(new URL(env.DATABASE_URL ?? '').protocol))
      issues.push('DATABASE_REQUIRED');
  } catch {
    issues.push('DATABASE_REQUIRED');
  }
  if (!env.UPLOAD_DIR || !/^(?:\/|[A-Za-z]:[\\/])/.test(env.UPLOAD_DIR))
    issues.push('ABSOLUTE_MEDIA_PATH_REQUIRED');
  return issues;
}
export type LaunchDatabaseEvidence = { issues: string[] };
export async function enforceProductionLaunch(
  env: LaunchEnv,
  readDatabase: () => Promise<LaunchDatabaseEvidence>,
) {
  if (env.NODE_ENV !== 'production') return;
  const issues = launchEnvironmentIssues(env);
  if (!issues.length && env.LAUNCH_MODE === 'public') {
    try {
      issues.push(...(await readDatabase()).issues);
    } catch {
      issues.push('DATABASE_CHECK_FAILED');
    }
  }
  if (issues.length) throw Error(`LAUNCH_BLOCKED: ${issues.join(', ')}`);
}
