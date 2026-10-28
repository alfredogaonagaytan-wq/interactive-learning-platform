import { GOOGLE_API_KEY, GOOGLE_APP_ID } from '../config';
import { driveAccessToken } from './gis';

/**
 * Google Drive Picker: the teacher chooses a file in their own Drive. Picking
 * grants this app (drive.file) access to that one file — nothing is made public
 * and no other Drive files become visible to the app.
 */
type PickerNS = {
  PickerBuilder: new () => {
    addView(v: unknown): unknown;
    setOAuthToken(t: string): unknown;
    setDeveloperKey(k: string): unknown;
    setAppId(id: string): unknown;
    setCallback(cb: (d: { action: string; docs?: Array<{ id: string; name: string; mimeType: string }> }) => void): unknown;
    setTitle(t: string): unknown;
    build(): { setVisible(v: boolean): void };
  };
  DocsView: new (viewId?: unknown) => { setMimeTypes(m: string): unknown; setIncludeFolders(b: boolean): unknown };
  ViewId: { DOCS: unknown };
  Action: { PICKED: string; CANCEL: string };
};
declare global {
  interface Window {
    gapi?: { load(name: string, cb: () => void): void };
  }
}

let loading: Promise<PickerNS> | null = null;
function loadPicker(): Promise<PickerNS> {
  loading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://apis.google.com/js/api.js';
    s.onload = () => window.gapi!.load('picker', () => resolve((window as unknown as { google: { picker: PickerNS } }).google.picker));
    s.onerror = () => {
      loading = null;
      reject(new Error('The Google Drive picker could not load.'));
    };
    document.head.appendChild(s);
  });
  return loading;
}

export const pickerAvailable = () => !!GOOGLE_API_KEY;

export async function pickDriveFile(mimeTypes: string, title: string): Promise<{ id: string; name: string; mimeType: string } | null> {
  if (!GOOGLE_API_KEY) throw new Error('Google Drive picking is not configured for this site.');
  const token = await driveAccessToken(true);
  const picker = await loadPicker();
  return new Promise((resolve) => {
    const view = new picker.DocsView(picker.ViewId.DOCS);
    view.setMimeTypes(mimeTypes);
    view.setIncludeFolders(true);
    const b = new picker.PickerBuilder() as unknown as Record<string, (...a: unknown[]) => unknown>;
    b.addView!(view);
    b.setOAuthToken!(token);
    b.setDeveloperKey!(GOOGLE_API_KEY);
    b.setAppId!(GOOGLE_APP_ID);
    b.setTitle!(title);
    b.setCallback!((d: { action: string; docs?: Array<{ id: string; name: string; mimeType: string }> }) => {
      if (d.action === picker.Action.PICKED) resolve(d.docs?.[0] ?? null);
      else if (d.action === picker.Action.CANCEL) resolve(null);
    });
    (b.build!() as { setVisible(v: boolean): void }).setVisible(true);
  });
}
