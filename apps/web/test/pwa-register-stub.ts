// Test stub for the vite-plugin-pwa virtual module (no service worker in jsdom).
export function useRegisterSW() {
  const noop = () => {};
  return { needRefresh: [false, noop], offlineReady: [false, noop], updateServiceWorker: async () => {} };
}
