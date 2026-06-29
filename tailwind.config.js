/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class', // toggled by .dark class on <html>
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    screens: {
      xs: '420px',
      sm: '640px',
      md: '768px',
      lg: '1024px',
      xl: '1280px',
      '2xl': '1536px'
    },
    extend: {
      colors: {
        // ── Surfaces ─────────────────────────────────────────
        // All driven by CSS vars in globals.css — flip automatically in dark mode.
        surface: {
          DEFAULT: 'var(--bg-surface)',
          muted:   'var(--bg-muted)',
          subtle:  'var(--bg-page)',
          sunken:  'var(--bg-sunken)'
        },
        // ── Theme text colors (use as `text-ink` etc.) ───────
        // Same variable scheme as the body, kept under the legacy `ink` key
        // so existing `text-ink` / `text-ink-soft` etc. still work.
        ink: {
          DEFAULT: 'var(--text)',
          soft:    'var(--text-soft)',
          mute:    'var(--text-mute)',
          faint:   'var(--text-faint)'
        },
        // ── Borders ──────────────────────────────────────────
        edge: {
          DEFAULT: 'var(--border)',
          strong:  'var(--border-strong)',
          deep:    'var(--border-deep)'
        },
        // ── Brand (SONY amber, used sparingly) ──────────────
        accent: {
          DEFAULT: 'var(--accent)',
          deep:    'var(--accent-deep)',
          soft:    'var(--accent-soft)',
          ink:     'var(--accent-ink)'
        },
        // ── Status pill palette (Monday.com friendly) ────────
        status: {
          staging:       { DEFAULT: '#EEE4F1', text: '#6B2D85' },
          in_progress:   { DEFAULT: '#DEE9F7', text: '#1F4A85' },
          client_review: { DEFAULT: '#FCE0EA', text: '#8E1F4A' },
          approved:      { DEFAULT: '#FFF1D1', text: '#6B4900' },
          posted:        { DEFAULT: '#D9F0E0', text: '#1F5C36' }
        },
        // ── Tag palette (categories + people mentions) ───────
        tag: {
          plum:    { DEFAULT: '#EEE4F1', text: '#6B2D85' },
          steel:   { DEFAULT: '#DEE9F7', text: '#1F4A85' },
          copper:  { DEFAULT: '#FCE5D5', text: '#8E4A1F' },
          rose:    { DEFAULT: '#FCE0EA', text: '#8E1F4A' },
          mint:    { DEFAULT: '#D9F0E0', text: '#1F5C36' },
          amber:   { DEFAULT: '#FFF1D1', text: '#6B4900' },
          slate:   { DEFAULT: '#E9EAEE', text: '#3A3A42' }
        },
        // ── Holiday / today ──────────────────────────────────
        holiday: {
          DEFAULT: 'var(--holiday)',
          tint:    'var(--holiday-tint)'
        },
        today: {
          DEFAULT: 'var(--accent-deep)',
          soft:    'var(--accent-soft)'
        },

        // ── Primary button color (always near-black on light,
        //    near-white on dark so CTAs stay readable) ────────
        btn: {
          DEFAULT: 'var(--btn-primary)',
          text:    'var(--btn-primary-text)',
          hover:   'var(--btn-primary-hover)'
        },

        // ── Legacy aliases ───────────────────────────────────
        paper:    { DEFAULT: 'var(--bg-surface)', deep: 'var(--bg-muted)', warm: 'var(--bg-page)' },
        rule:     { DEFAULT: 'var(--border-deep)', soft: 'var(--border)' },
        magenta:  '#E5616B',
        copper:   '#C2733A',
        steel:    '#4A6FA5',
        forest:   '#3E8E5A',
        rust:     '#B0413E',
        plum:     '#8B4FA8',
        sony:     { DEFAULT: '#000000', accent: 'var(--accent)' }
      },
      fontFamily: {
        sans:    ['var(--font-sans)'],
        display: ['var(--font-display)'],
        mono:    ['var(--font-mono)']
      },
      letterSpacing: {
        tightest: '-0.05em',
        editorial: '-0.02em'
      },
      borderRadius: {
        xl: '0.875rem'
      },
      boxShadow: {
        soft:   '0 1px 2px rgba(15, 18, 28, 0.04), 0 1px 1px rgba(15, 18, 28, 0.04)',
        card:   '0 2px 6px rgba(15, 18, 28, 0.05), 0 1px 2px rgba(15, 18, 28, 0.04)',
        pop:    '0 12px 32px rgba(15, 18, 28, 0.12), 0 4px 12px rgba(15, 18, 28, 0.08)',
        ring:   '0 0 0 4px rgba(255, 176, 0, 0.18)'
      }
    }
  },
  plugins: []
};