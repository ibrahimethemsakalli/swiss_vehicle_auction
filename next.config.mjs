/** @type {import('next').NextConfig} */
const config = {
  allowedDevOrigins: ['127.0.0.1'],
  async headers() {
    return [
      { source: '/sw.js', headers: [
        { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
        { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
        { key: 'Service-Worker-Allowed', value: '/' },
      ] },
      { source: '/offline.html', headers: [
        { key: 'Cache-Control', value: 'no-store' },
        { key: 'Content-Security-Policy', value: "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" },
      ] },
    ];
  },
  ...(process.env.CI_BUILD === 'true'
    ? {
        distDir: '.local/next-ci-build',
        typescript: { tsconfigPath: 'tsconfig.ci.json' },
        experimental: { cpus: 2 },
      }
    : {}),
};
export default config;
