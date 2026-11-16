// File: omnirag-frontend/tailwind.config.js
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        midnight: {
          950: '#020504', // Outer pitch-black background
          900: '#060c09', // Main app container surface
          800: '#0b1410', // Elevated card & message surface
          700: '#12211a', // Subtle border / inactive surface
        },
        neon: {
          400: '#34d399', // Bright highlight text & active dots
          500: '#10b981', // Primary emerald border glow
          600: '#059669', // Deep emerald accent
        },
        abstain: {
          bg: '#1c180d',     // Dark amber background for "System Abstained"
          border: '#4d3f1a', // Muted amber border
          text: '#d4b872',   // Warm amber warning text
        },
      },
      boxShadow: {
        'emerald-window':
          '0 0 60px -15px rgba(16, 185, 129, 0.25), 0 0 25px -10px rgba(16, 185, 129, 0.15)',
        'emerald-glow':
          '0 0 25px rgba(16, 185, 129, 0.35), inset 0 0 15px rgba(16, 185, 129, 0.12)',
        'emerald-input':
          '0 0 30px rgba(16, 185, 129, 0.4), inset 0 0 12px rgba(16, 185, 129, 0.15)',
        'emerald-btn':
          '0 0 25px rgba(52, 211, 153, 0.75), inset 0 0 10px rgba(255, 255, 255, 0.35)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
};