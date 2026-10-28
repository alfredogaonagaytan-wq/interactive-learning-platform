import { strFromU8, strToU8, unzipSync, zipSync, type Unzipped } from 'fflate';
import { z } from 'zod';
import type { Activity } from '../schema/activity';
import { canonicalJson, sha256Hex } from '../hash';
import { activityAssets } from '../items/registry';
import { assetIdFor, EXTENSIONS, sniffAnyType, type MediaType, MAX_AUDIO_BYTES } from './media';
import { PACKAGE_KIND, PackageError, parsePackageActivities, readPackage, type ImportResult } from './package';

/**
 * Zip package (".ilp.zip"), format 2:
 *   package.json   envelope { kind, formatVersion: 2, activities, media[], integrity }
 *   media/<assetId>.<ext>
 * The integrity digest covers activities + media manifest; each media file is
 * verified against its content-addressed id. Unknown entries are ignored.
 */
export const ZIP_PACKAGE_EXTENSION = '.ilp.zip';
export const ZIP_FORMAT_VERSION = 2;
const MAX_ENTRIES = 600;
const MAX_TOTAL_UNCOMPRESSED = 150 * 1024 * 1024;

export interface PackagedAsset {
  id: string;
  mime: MediaType;
  bytes: Uint8Array;
}

const MediaEntrySchema = z.object({ id: z.string().regex(/^ast_[0-9a-f]{40}$/), mime: z.string(), path: z.string(), size: z.number().int().min(0) });
const ZipEnvelopeSchema = z.object({
  kind: z.literal(PACKAGE_KIND),
  formatVersion: z.number().int(),
  exportedAt: z.string(),
  generator: z.string().max(200),
  activities: z.array(z.unknown()).min(1).max(500),
  media: z.array(MediaEntrySchema).max(MAX_ENTRIES),
  integrity: z.object({ algorithm: z.literal('SHA-256'), digest: z.string() }),
});

export async function createZipPackage(
  activities: Activity[],
  getAsset: (id: string) => Promise<{ mime: MediaType; bytes: Uint8Array } | undefined>,
  generator = 'ilp-web/0.2.0',
  now = new Date(),
): Promise<Uint8Array> {
  const clean = activities.map((a) => ({ ...a, publishedVersion: null, publishedRevision: null }));
  const files: Record<string, Uint8Array> = {};
  const media: Array<z.infer<typeof MediaEntrySchema>> = [];
  const ids = [...new Set(clean.flatMap(activityAssets))].sort();
  for (const id of ids) {
    const a = await getAsset(id);
    if (!a) throw new PackageError(`An image used by this activity is missing from this device (${id}). Re-add it before exporting.`);
    const path = `media/${id}.${EXTENSIONS[a.mime]}`;
    files[path] = a.bytes;
    media.push({ id, mime: a.mime, path, size: a.bytes.byteLength });
  }
  const envelope = {
    kind: PACKAGE_KIND,
    formatVersion: ZIP_FORMAT_VERSION,
    exportedAt: now.toISOString(),
    generator,
    activities: clean,
    media,
    integrity: { algorithm: 'SHA-256' as const, digest: await sha256Hex(canonicalJson({ activities: clean, media })) },
  };
  files['package.json'] = strToU8(JSON.stringify(envelope, null, 2));
  // Media is already compressed; store it, deflate only the JSON.
  return zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, [v, { level: k.endsWith('.json') ? 6 : 0 }]])) as never);
}

export interface ZipImportResult extends ImportResult {
  assets: PackagedAsset[];
}

const isZip = (b: Uint8Array) => b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;

/** Read either a zip package (format 2) or a legacy JSON package (format 1). */
export async function readAnyPackage(bytes: Uint8Array): Promise<ZipImportResult> {
  if (!isZip(bytes)) {
    const r = await readPackage(strFromU8(bytes));
    return { ...r, assets: [] };
  }
  let entries = 0;
  let total = 0;
  let files: Unzipped;
  try {
    files = unzipSync(bytes, {
      filter: (f) => {
        entries++;
        total += f.originalSize;
        if (entries > MAX_ENTRIES || total > MAX_TOTAL_UNCOMPRESSED) throw new PackageError('Package is too large or has too many files.');
        return f.name === 'package.json' || /^media\/ast_[0-9a-f]{40}\.[a-z0-9]{2,5}$/.test(f.name);
      },
    });
  } catch (e) {
    if (e instanceof PackageError) throw e;
    throw new PackageError('This file is not a valid activity package (damaged zip).');
  }
  const manifest = files['package.json'];
  if (!manifest) throw new PackageError('This zip is not an activity package (package.json missing).');
  let json: unknown;
  try {
    json = JSON.parse(strFromU8(manifest));
  } catch {
    throw new PackageError('The package manifest is not valid JSON.');
  }
  const env = ZipEnvelopeSchema.safeParse(json);
  if (!env.success) throw new PackageError('This file is not an activity package.');
  if (env.data.formatVersion > ZIP_FORMAT_VERSION) throw new PackageError('This package was made with a newer version of the app.');
  const digest = await sha256Hex(canonicalJson({ activities: env.data.activities, media: env.data.media }));
  if (digest !== env.data.integrity.digest) throw new PackageError('The package appears damaged or was edited outside the app (integrity check failed).');

  const assets: PackagedAsset[] = [];
  for (const m of env.data.media) {
    const data = files[m.path];
    if (!data) throw new PackageError(`The package is missing a media file (${m.path}).`);
    const mime = sniffAnyType(data);
    if (!mime || data.byteLength > MAX_AUDIO_BYTES) throw new PackageError(`Media file ${m.path} is not an allowed type.`);
    if ((await assetIdFor(data)) !== m.id) throw new PackageError(`Media file ${m.path} does not match its checksum.`);
    assets.push({ id: m.id, mime, bytes: data });
  }
  const activities = parsePackageActivities(env.data.activities);
  const have = new Set(assets.map((a) => a.id));
  const missing = activities.flatMap(activityAssets).filter((id) => !have.has(id));
  if (missing.length) throw new PackageError(`The package references ${missing.length} image(s) it does not contain.`);
  return { activities, assets, warnings: [] };
}
