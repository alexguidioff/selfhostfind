import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  darkMode: 'media',
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef6ff',
          100: '#d9ebff',
          500: '#2f6fed',
          600: '#2457c4',
          700: '#1c449a',
        },
      },
    },
  },
  plugins: [],
};

export default config;
