/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    "./*.html",
    "./js/**/*.js"
  ],
  theme: {
    extend: {
      colors: {
        surface: '#1e293b', // slate-800
        bg: '#0f172a', // slate-900
      }
    },
  },
  plugins: [],
}
