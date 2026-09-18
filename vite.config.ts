import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Relative base so the same build works from a local `vite preview`,
// from a file:// checkout and from a GitHub Pages project sub-path
// (https://<user>.github.io/uart-lab/) without rebuilding.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      output: {
        // Split the vendors so a change to the app does not invalidate the
        // component library and the charting toolkit in the browser cache.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('@mantine')) return 'mantine'
          if (id.includes('@visx') || id.includes('/d3-')) return 'charts'
          return 'vendor'
        },
      },
    },
  },
  test: {
    globals: true,
    // The protocol layer is DOM-free and runs in node; only the UI tests need
    // a document, which they opt into with a `@vitest-environment` pragma.
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    setupFiles: ['src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/core/**', 'src/devices/**', 'src/ui/charts/bucketSamples.ts'],
    },
  },
})
