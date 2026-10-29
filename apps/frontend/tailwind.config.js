/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#17253b',
        emerald: { 50: '#edf9f5', 100: '#d8f2e7', 500: '#1ca584', 600: '#148a70', 700: '#0c6a57' },
      },
      boxShadow: { panel: '0 3px 18px rgba(25, 43, 67, 0.035)', float: '0 18px 55px rgba(12, 27, 49, 0.18)' },
    },
  },
  plugins: [],
};
