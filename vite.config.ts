import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import tailwindcss from '@tailwindcss/vite';

// https://vitejs.dev/config/
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
    electron([
      {
        entry: 'electron/main.ts',
      },
      // Preload is compiled separately via esbuild (CJS) — see package.json build script
    ]),
  ],
});
