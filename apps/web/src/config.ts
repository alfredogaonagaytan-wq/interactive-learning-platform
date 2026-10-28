/**
 * Public configuration. The OAuth client id and the (referrer-restricted)
 * Picker API key are not secrets: they are visible to every browser that loads
 * the app. No client secret or service-account key is ever used.
 * Build-time overrides: VITE_GOOGLE_CLIENT_ID, VITE_GOOGLE_API_KEY.
 */
export const GOOGLE_CLIENT_ID: string = import.meta.env.VITE_GOOGLE_CLIENT_ID || '964954121204-g9k3t57l2rvcgpgr32pv8g35sd4o4apu.apps.googleusercontent.com';
export const GOOGLE_API_KEY: string = import.meta.env.VITE_GOOGLE_API_KEY || '';
/** Cloud project number (first part of the client id), used by the Drive Picker. */
export const GOOGLE_APP_ID = GOOGLE_CLIENT_ID.split('-')[0] ?? '';
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
