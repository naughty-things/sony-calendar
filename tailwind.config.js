/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        paper:    { DEFAULT: '#F4F1EA', deep: '#EBE6D9', warm: '#FAF8F2' },
        ink:      { DEFAULT: '#0B0B0E', soft: '#1C1C22', mute: '#4A4A52', faint: '#7A7A82' },
        rule:     { DEFAULT: '#1A1A1E', soft: '#C7C0AE' },
        accent:   { DEFAULT: '#FFB000', deep: '#E89B00', soft: '#FFD66B' },
        magenta:  '#D8265A',
        copper:   '#C86A2C',
        steel:    '#2F4B6E',
        forest:   '#2E5C3A',
        rust:     '#A03A24',
        plum:     '#7A3DA8',
        sony:     { DEFAULT: '#000000', accent: '#FFB000' }
      },
      fontFamily: {
        sans:    ['var(--font-sans)'],
        display: ['var(--font-display)'],
        mono:    ['var(--font-mono)']
      },
      letterSpacing: {
        tightest: '-0.05em',
        editorial: '-0.02em'
      }
    }
  },
  plugins: []
};
