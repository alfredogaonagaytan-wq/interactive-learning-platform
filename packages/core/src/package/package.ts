import { z } from 'zod';
import { ActivitySchema, type Activity } from '../schema/activity';
import { migrateActivityJson } from '../schema/migrations';
import { canonicalJson, sha256Hex } from '../hash';

/**
 * Portable activity package (".ilp.json"). Phase 1 is a single JSON file;
 * a zip container with media/ folder is planned once media upload lands.
 *
 * Integrity: a SHA-256 digest over the canonical JSON of `activities`
 * detects accidental corruption. It is NOT a signature and does not prove
 * authorship — anyone can recompute it.
 */
export const PACKAGE_KIND = 'ilp.package';
export const PACKAGE_FORMAT_VERSION = 1;
export const MAX_PACKAGE_BYTES = 20 * 1024 * 1024;
export const PACKAGE_EXTENSION = '.ilp.json';

const PackageEnvelopeSchema = z.object({
  kind: z.literal(PACKAGE_KIND),
  formatVersion: z.number().int(),
  exportedAt: z.string(),
  generator: z.string().max(200),
  activities: z.array(z.unknown()).min(1).max(500),
  integrity: z.object({ algorithm: z.literal('SHA-256'), digest: z.string() }),
});

export interface ActivityPackage {
  kind: typeof PACKAGE_KIND;
  formatVersion: number;
  exportedAt: string;
  generator: string;
  activities: Activity[];
  integrity: { algorithm: 'SHA-256'; digest: string };
}

/** Strip local publication bookkeeping so the recipient gets a clean draft. */
function forExport(a: Activity): Activity {
  return { ...a, publishedVersion: null, publishedRevision: null };
}

export async function createPackage(activities: Activity[], generator = 'ilp-web/0.1.0', now = new Date()): Promise<ActivityPackage> {
  const clean = activities.map(forExport);
  return {
    kind: PACKAGE_KIND,
    formatVersion: PACKAGE_FORMAT_VERSION,
    exportedAt: now.toISOString(),
    generator,
    activities: clean,
    integrity: { algorithm: 'SHA-256', digest: await sha256Hex(canonicalJson(clean)) },
  };
}

export class PackageError extends Error {}

export interface ImportResult {
  activities: Activity[];
  warnings: string[];
}

export async function readPackage(text: string): Promise<ImportResult> {
  if (new TextEncoder().encode(text).byteLength > MAX_PACKAGE_BYTES) throw new PackageError('File is too large (limit 20 MB).');
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new PackageError('This file is not a valid activity package (not JSON).');
  }
  const env = PackageEnvelopeSchema.safeParse(json);
  if (!env.success) throw new PackageError('This file is not an activity package.');
  if (env.data.formatVersion > PACKAGE_FORMAT_VERSION) throw new PackageError('This package was made with a newer version of the app.');
  const warnings: string[] = [];
  const digest = await sha256Hex(canonicalJson(env.data.activities));
  if (digest !== env.data.integrity.digest) {
    throw new PackageError('The package appears damaged or was edited outside the app (integrity check failed).');
  }
  const activities = parsePackageActivities(env.data.activities);
  return { activities, warnings };
}

export function parsePackageActivities(raws: unknown[]): Activity[] {
  return raws.map((raw, i) => {
    try {
      return ActivitySchema.parse(migrateActivityJson(raw));
    } catch (e) {
      const msg = e instanceof z.ZodError ? e.issues.slice(0, 3).map((x) => `${x.path.join('.')}: ${x.message}`).join('; ') : (e as Error).message;
      throw new PackageError(`Activity ${i + 1} is invalid: ${msg}`);
    }
  });
}
