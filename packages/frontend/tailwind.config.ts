import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // amazon-pulse brand palette: ink + accent + status colours
        ink: {
          50:  '#f7f8fa',
          100: '#eceef2',
          200: '#d3d7df',
          300: '#a8aebd',
          500: '#5b6478',
          700: '#2c3242',
          900: '#0e1018',
        },
        accent: {
          DEFAULT: '#ff9900', // Amazon orange — used sparingly for the wordmark
          dark:    '#e07b00',
        },
        ok:   '#16a34a',
        warn: '#d97706',
        bad:  '#dc2626',
      },
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'monospace'],
      },
    },
  },
  plugins: [],
};

export default config;
