import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import { clearAllData, closeDb } from '../src/storage/db';

// jsdom has no object URLs; the app only needs stable strings for <img src>.
if (!URL.createObjectURL) {
  let n = 0;
  URL.createObjectURL = () => `blob:test/${n++}`;
  URL.revokeObjectURL = () => {};
}

afterEach(async () => {
  cleanup();
  await clearAllData();
  await closeDb();
  window.location.hash = '';
});
