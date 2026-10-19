import type { Config } from 'tailwindcss';
export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: { extend: { colors: { navy: '#0F172A', alpine: '#10B981', bid: '#EF4444' } } },
  plugins: [],
} satisfies Config;
