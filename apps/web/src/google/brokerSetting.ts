import { getMeta, setMeta } from '../storage/db';
/** The teacher's own submission service (Apps Script deployment id), stored on this device. */
export const getBrokerId = () => getMeta<string>('brokerId');
export const setBrokerId = (id: string | null) => setMeta('brokerId', id);
