/** @type {import('next').NextConfig} */
const config = {
  ...(process.env.CI_BUILD === 'true'
    ? {
        distDir: '.local/next-ci-build',
        typescript: { tsconfigPath: 'tsconfig.ci.json' },
        experimental: { cpus: 2 },
      }
    : {}),
};
export default config;
