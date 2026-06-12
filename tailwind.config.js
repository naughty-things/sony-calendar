/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        sony: { DEFAULT: '#000000', accent: '#FFB800' }
      }
    }
  },
  plugins: []
};
