import { ActivitySchema, type Activity, type PublishedVersion } from './schema/activity';
import { validateActivity } from './items/registry';
import { contentHash } from './hash';
import type { ValidationIssue } from './grading/types';

export class PublishError extends Error {
  constructor(public issues: ValidationIssue[]) {
    super(issues.map((i) => i.message).join(' '));
  }
}

/**
 * Create the next immutable version of an activity. Returns the snapshot and
 * the updated draft (with publishedVersion bumped). Throws PublishError if the
 * activity is not ready for students.
 */
export async function publishActivity(draft: Activity, now = new Date()): Promise<{ version: PublishedVersion; draft: Activity }> {
  const parsed = ActivitySchema.parse(draft);
  const issues = validateActivity(parsed);
  if (issues.length > 0) throw new PublishError(issues);
  const versionNumber = (parsed.publishedVersion ?? 0) + 1;
  const snapshot: Activity = structuredClone({ ...parsed, publishedVersion: versionNumber, publishedRevision: parsed.revision });
  const version: PublishedVersion = {
    kind: 'ilp.publishedVersion',
    activityId: parsed.id,
    version: versionNumber,
    publishedAt: now.toISOString(),
    contentHash: await contentHash({ ...snapshot, updatedAt: undefined, publishedVersion: undefined, publishedRevision: undefined, revision: undefined }),
    activity: snapshot,
  };
  return { version, draft: { ...parsed, publishedVersion: versionNumber, publishedRevision: parsed.revision } };
}

export function hasUnpublishedChanges(a: Activity): boolean {
  return a.publishedRevision === null || a.revision !== a.publishedRevision;
}
