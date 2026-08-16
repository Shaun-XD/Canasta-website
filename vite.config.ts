import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// On Vercel, Online mode needs a public API URL baked in at build time.
// Without it the client falls back to localhost, which fails on preview/prod.
if (process.env.VERCEL && !process.env.VITE_SOCKET_URL) {
  console.warn(
    '\n[canasta] VITE_SOCKET_URL is unset on Vercel.\n' +
      '  Online multiplayer will try http://localhost:4000 and fail.\n' +
      '  Set VITE_SOCKET_URL to your Railway HTTPS URL (Production + Preview).\n' +
      '  See docs/DEPLOY.md\n',
  )
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
    host: true,
  },
})
