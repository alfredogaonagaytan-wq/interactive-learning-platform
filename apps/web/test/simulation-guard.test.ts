/** Outside Simulation mode, links to simulated services are refused (no fictional data can be mistaken for real). */
import { describe, expect, it, vi } from 'vitest';
import { broker } from '../src/google/broker';
import { dbName } from '../src/storage/db';

describe('real mode', () => {
  it('refuses simulated service links and uses the real database', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await expect(broker.studentAssignment('SIMULATEDabcdefghijklmnopqrstuvwx', 'asg_x')).rejects.toThrow(/belongs to Simulation mode/);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(dbName()).toBe('ilp');
  });
});
