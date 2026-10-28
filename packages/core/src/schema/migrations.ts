import { ActivitySchema, CURRENT_SCHEMA_VERSION, type Activity } from './activity';

/**
 * Forward-only migrations. Each entry upgrades raw JSON from version N to N+1.
 * Rules:
 *  - never delete teacher content during migration; move unknown data to `legacy`
 *  - every migration gets a fixture test
 *  - documents from a *newer* schema are rejected, never down-converted silently
 */
export type Migration = (raw: Record<string, unknown>) => Record<string, unknown>;

export const activityMigrations: Record<number, Migration> = {
  // v1 -> v2 (Phase 2): question pools added; new item types are additive.
  1: (raw) => ({ ...raw, schemaVersion: 2, pools: Array.isArray(raw.pools) ? raw.pools : [] }),
  // v2 -> v3 (Phase 3): audio cues on questions (default none) and language item types; additive.
  2: (raw) => ({ ...raw, schemaVersion: 3 }),
};

export class SchemaVersionError extends Error {}

export function migrateActivityJson(
  input: unknown,
  migrations: Record<number, Migration> = activityMigrations,
  target: number = CURRENT_SCHEMA_VERSION,
): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new SchemaVersionError('Activity must be a JSON object');
  let raw = { ...(input as Record<string, unknown>) };
  const v = raw.schemaVersion;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) throw new SchemaVersionError('Missing or invalid schemaVersion');
  if (v > target) {
    throw new SchemaVersionError(`This activity was made with a newer version of the app (schema ${v}). Please update the app.`);
  }
  for (let cur = v; cur < target; cur++) {
    const step = migrations[cur];
    if (!step) throw new SchemaVersionError(`No migration from schema ${cur}`);
    raw = step(raw);
  }
  return raw;
}

export function parseActivity(input: unknown): Activity {
  return ActivitySchema.parse(migrateActivityJson(input));
}

/** Upgrade a stored published version (its embedded activity) to the current schema, in memory only. */
export function upgradePublishedVersion<T extends { activity: unknown }>(v: T): T & { activity: Activity } {
  return { ...v, activity: parseActivity(v.activity) };
}
