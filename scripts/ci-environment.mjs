import { resolve } from 'node:path';

export function ciEnvironment(source = process.env, databaseUrl = '') {
  const env = { ...source };
  // Explicit empty values prevent Next/dotenv from loading a developer's real .env values.
  for (const key of Object.keys(env)) {
    if (/^(STRIPE_|TWILIO_|NEXT_PUBLIC_STRIPE_|SMTP_|EMAIL_SERVER|DATATRANS_)/.test(key))
      env[key] = '';
  }
  Object.assign(env, {
    CI: 'true',
    CI_BUILD: 'false',
    PUBLIC_SITE_URL: '',
    SEO_INDEXING_ENABLED: 'false',
    NEXT_TELEMETRY_DISABLED: '1',
    DATABASE_URL: databaseUrl,
    TEST_DATABASE_URL: databaseUrl,
    DB_POOL_MAX: '10',
    DB_CONNECT_TIMEOUT_MS: '5000',
    DB_IDLE_TIMEOUT_MS: '10000',
    NEXTAUTH_URL: 'http://127.0.0.1:3000',
    NEXTAUTH_SECRET: 'ci-only-placeholder-not-for-production-000000000000',
    LOCAL_TEST_PAYMENTS: 'false',
    LOCAL_TEST_MESSAGES: 'false',
    OCR_ENABLED: 'false',
    STRIPE_ALLOW_LIVE: 'false',
    STRIPE_SECRET_KEY: '',
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: '',
    STRIPE_WEBHOOK_SECRET: '',
    TWILIO_ACCOUNT_SID: '',
    TWILIO_AUTH_TOKEN: '',
    TWILIO_VERIFY_SERVICE_SID: '',
    UPLOAD_DIR: resolve('.local/ci/uploads'),
    OPERATIONS_DIR: resolve('.local/ci/operations'),
    OPS_INSTANCE_ID: '',
    RESTORE_DATABASE_URL: '',
    RESTORE_UPLOAD_DIR: '',
  });
  // Do not inherit local process injection or debugger settings into CI children.
  delete env.NODE_OPTIONS;
  delete env.NODE_ENV;
  return env;
}
