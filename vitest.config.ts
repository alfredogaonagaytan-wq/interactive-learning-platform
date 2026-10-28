import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'core',
          root: './packages/core',
          include: ['test/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'broker',
          root: './services/submission-broker',
          include: ['test/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        plugins: [react()],
        resolve: {
          alias: { 'virtual:pwa-register/react': new URL('./apps/web/test/pwa-register-stub.ts', import.meta.url).pathname },
        },
        test: {
          name: 'web',
          root: './apps/web',
          include: ['test/**/*.test.{ts,tsx}'],
          environment: 'jsdom',
          setupFiles: ['./test/setup.ts'],
        },
      },
    ],
  },
});
