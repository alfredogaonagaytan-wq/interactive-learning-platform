/**
 * Simulation mode: try the whole platform with fictional teachers and students
 * and SIMULATED Google services, without signing in to Google or connecting a
 * Drive. Everything lives in separate browser databases ("ilp-simulation…"),
 * never mixes with real work, and nothing is sent to Google.
 *
 * Safeguards:
 *  - simulated service ids start with SIMULATED; the app refuses to send real
 *    sign-ins to them, and refuses to contact real services while simulating
 *  - simulated sign-ins are unsigned and issued for a different (invalid)
 *    client id, so a real service rejects them before even asking Google
 *  - everything shown is labelled "Simulation"
 */
const KEY = 'ilp.mode';

export function isSimulation(): boolean {
  try {
    return localStorage.getItem(KEY) === 'simulation';
  } catch {
    return false;
  }
}

/** Switches mode and reloads, so every database is reopened for the new mode. */
export function setSimulation(on: boolean, then = on ? '#/simulation' : '#/settings'): void {
  try {
    if (on) localStorage.setItem(KEY, 'simulation');
    else localStorage.removeItem(KEY);
  } catch {
    /* storage blocked: simulation cannot be turned on */
  }
  window.location.hash = then;
  window.location.reload();
}

export const SIM_BROKER_PREFIX = 'SIMULATED';
export const isSimulatedBroker = (id: string) => id.startsWith(SIM_BROKER_PREFIX);
/** Not a real OAuth client: real services reject simulated tokens on this alone. */
export const SIM_CLIENT_ID = 'simulated-client.apps.invalid';
export const SIM_DB_SUFFIX = '-simulation';
