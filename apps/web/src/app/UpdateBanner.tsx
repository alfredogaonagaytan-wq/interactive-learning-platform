import { useRegisterSW } from 'virtual:pwa-register/react';

/**
 * The service worker never reloads the page by itself (that could interrupt a
 * student mid-activity). Instead we ask, and work is already autosaved.
 */
export function UpdateBanner() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker,
  } = useRegisterSW();
  if (!needRefresh && !offlineReady) return null;
  return (
    <div className="update-banner" role="status">
      {needRefresh ? (
        <>
          <span>A new version of the app is available. Your work is saved.</span>
          <button type="button" className="primary" onClick={() => void updateServiceWorker(true)}>Reload now</button>
          <button type="button" className="ghost" onClick={() => setNeedRefresh(false)}>Later</button>
        </>
      ) : (
        <>
          <span>The app is ready to work offline.</span>
          <button type="button" className="ghost" onClick={() => setOfflineReady(false)}>OK</button>
        </>
      )}
    </div>
  );
}
