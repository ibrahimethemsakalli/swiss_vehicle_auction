export function pwaEnabled(env = process.env) {
  return (
    env.PWA_ENABLED === 'true' || (env.NODE_ENV === 'production' && env.PWA_ENABLED !== 'false')
  );
}
