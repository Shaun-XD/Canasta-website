import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    environment: 'jsdom',
    // Engine unit tests don't need DOM; avoid jsdom ESM/CJS sniffs on Windows.
    environmentMatchGlobs: [
      ['src/engine/**', 'node'],
      ['**/onlineInvariants.test.ts', 'node'],
      ['src/hooks/useHandReorder.test.ts', 'node'],
    ],
  },
})
