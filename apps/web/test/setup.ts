import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import { clearAllData, closeDb } from '../src/storage/db';

afterEach(async () => {
  cleanup();
  await clearAllData();
  await closeDb();
  window.location.hash = '';
});
