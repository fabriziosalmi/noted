import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// https://vitejs.dev/config/
// Note: main.ts and preload.ts are compiled via esbuild (see package.json scripts)
// to avoid Vite 8/rolldown incompatibilities with Node.js built-in modules.
export default defineConfig({
  server: {
    port: 8066,
    strictPort: true,
  },
  build: {
    // KaTeX + TipTap make the bundle large by design; suppress size warning
    chunkSizeWarningLimit: 2000,
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      exclude: [
        'node_modules/',
        'src/test/',
        '**/*.d.ts',
        '**/*.config.*',
        'electron/'
      ]
    }
  },
  plugins: [
    tailwindcss(),
    react(),
  ],
});
