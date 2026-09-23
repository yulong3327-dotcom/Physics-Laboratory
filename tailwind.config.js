/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        accent: '#087f72',
        'accent-2': '#4b8cac',
        'surface': '#ffffff',
        'surface-muted': '#f7f9f8',
        'ink': '#25322f',
        'muted': '#78827e',
        'rule': '#e2e7e5',
      },
    },
  },
  plugins: [],
}
