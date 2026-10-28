import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Strict Content-Security-Policy for production builds (the dev server needs inline scripts for HMR).
// Phase 5 adds accounts.google.com / apis.google.com / www.googleapis.com for Google sign-in and Drive.
// Google hosts are needed only for sign-in (accounts.google.com), Drive (www.googleapis.com),
// the Drive file picker (apis.google.com, docs.google.com) and teachers' Apps Script services.
const CSP = [
  "default-src 'self'",
  "script-src 'self' https://accounts.google.com https://apis.google.com",
  "style-src 'self' 'unsafe-inline' https://accounts.google.com",
  "img-src 'self' data: blob: https://*.googleusercontent.com https://ssl.gstatic.com https://www.gstatic.com",
  "media-src 'self' blob:",
  "connect-src 'self' https://accounts.google.com https://www.googleapis.com https://content.googleapis.com https://script.google.com https://script.googleusercontent.com",
  "frame-src https://accounts.google.com https://docs.google.com https://drive.google.com",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

// Build the teacher's Apps Script files and serve them at /broker/* for the copy buttons on the setup page.
const brokerFiles = {
  name: 'ilp-broker-files',
  buildStart() {
    const root = fileURLToPath(new URL('../../services/submission-broker/', import.meta.url));
    execFileSync(process.execPath, [join(root, 'build.mjs')], { stdio: 'inherit', env: { ...process.env, ILP_GOOGLE_CLIENT_ID: process.env.VITE_GOOGLE_CLIENT_ID || '964954121204-g9k3t57l2rvcgpgr32pv8g35sd4o4apu.apps.googleusercontent.com' } });
    const out = fileURLToPath(new URL('./public/broker/', import.meta.url));
    mkdirSync(out, { recursive: true });
    for (const f of ['Code.gs', 'GradingCore.gs', 'appsscript.json']) copyFileSync(join(root, 'dist', f), join(out, f));
  },
};

const cspPlugin = {
  name: 'ilp-csp',
  apply: 'build' as const,
  transformIndexHtml: () => [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP }, injectTo: 'head-prepend' as const }],
};

// Static build: deployable to GitHub Pages / Cloudflare Pages / any static host.
// Set BASE_PATH=/repo-name/ for GitHub Pages project sites.
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [
    react(),
    brokerFiles,
    // The hosted preview (claude.ai artifact) applies its own CSP; skip ours there.
    ...(process.env.ILP_HOSTED_PREVIEW ? [] : [cspPlugin]),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Interactive Learning Platform',
        short_name: 'Learning',
        description: 'Create and complete interactive learning activities — offline-capable and private by design.',
        theme_color: '#1f5f5b',
        background_color: '#f7f5f0',
        display: 'standalone',
        start_url: '.',
        scope: '.',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        globIgnores: ['broker/**'],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
      },
      devOptions: { enabled: false },
    }),
  ],
  build: { target: 'es2022', sourcemap: !process.env.ILP_HOSTED_PREVIEW, outDir: process.env.ILP_OUT_DIR ?? 'dist', emptyOutDir: true },
});
