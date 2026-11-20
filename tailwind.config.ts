import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './lib/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        arena: '#F7F1E5',
        superficie: '#EFE5D3',
        tarjeta: '#FFFDF8',
        terracota: '#E45735',
        verdeCabo: '#1B8A7A',
        solAlmeria: '#F2B84B',
        azulMed: '#2C6E91',
        buganvilla: '#B84A62',
        tinta: '#1E242B',
      },
      fontFamily: {
        heading: ['var(--font-outfit)', 'sans-serif'],
        sans: ['var(--font-jakarta)', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

export default config;
