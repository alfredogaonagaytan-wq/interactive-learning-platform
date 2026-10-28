import { z } from 'zod';
import { AudioCueField, FeedbackSchema, IdSchema, ImageRefSchema, PointsSchema, ShortTextSchema, SkillTagsSchema, TextSchema } from '../schema/common';
import type { ValidationIssue } from '../grading/types';
import { outcome, outcomeFeedback, type ItemDefinition } from './definition';

const Percent = z.number().min(0).max(100);

/** Find the hotspot: click the correct region of an image. */
export const HotspotSchema = z.object({
  id: IdSchema,
  label: ShortTextSchema,
  shape: z.enum(['rect', 'ellipse']).default('rect'),
  x: Percent,
  y: Percent,
  w: Percent,
  h: Percent,
  correct: z.boolean().default(false),
  feedback: ShortTextSchema.optional(),
});
export const HotspotItemSchema = z.object({
  type: z.literal('hotspot'),
  id: IdSchema,
  /** Optional link to an audio clip in this activity (listening tasks). */
  audioCue: AudioCueField,
  prompt: TextSchema,
  image: ImageRefSchema.nullable().default(null),
  hotspots: z.array(HotspotSchema).max(30),
  /**
   * Offer "choose from a list" (the hotspot labels) as an accessible alternative
   * for screen-reader and switch users. Teachers can turn it off when the labels
   * would give the answer away; keyboard crosshair input remains available.
   */
  allowListAlternative: z.boolean().default(true),
  points: PointsSchema.default(1),
  feedback: FeedbackSchema.default({}),
  skills: SkillTagsSchema,
});
export type HotspotItem = z.infer<typeof HotspotItemSchema>;
export type Hotspot = z.infer<typeof HotspotSchema>;
export interface HotspotResponse {
  point: { x: number; y: number } | null;
  /** Set when the student used the list alternative. */
  hotspotId: string | null;
}

export function hitTest(item: HotspotItem, x: number, y: number): Hotspot | undefined {
  // Later hotspots are drawn on top, so test from last to first.
  for (const h of [...item.hotspots].reverse()) {
    if (h.shape === 'rect') {
      if (x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h) return h;
    } else {
      const rx = h.w / 2;
      const ry = h.h / 2;
      if (rx > 0 && ry > 0 && ((x - (h.x + rx)) / rx) ** 2 + ((y - (h.y + ry)) / ry) ** 2 <= 1) return h;
    }
  }
  return undefined;
}

export function chosenHotspot(item: HotspotItem, r: HotspotResponse | undefined): Hotspot | undefined {
  if (!r) return undefined;
  if (r.hotspotId) return item.hotspots.find((h) => h.id === r.hotspotId);
  return r.point ? hitTest(item, r.point.x, r.point.y) : undefined;
}

export const hotspotDefinition: ItemDefinition<HotspotItem, HotspotResponse> = {
  type: 'hotspot',
  label: 'Find the hotspot',
  scorable: true,
  emptyResponse: () => ({ point: null, hotspotId: null }),
  isAnswered: (_i, r) => !!r && (r.point !== null || r.hotspotId !== null),
  maxScore: (i) => i.points,
  assets: (i) => (i.image ? [i.image.assetId] : []),
  grade(item, response) {
    const answered = !!response && (response.point !== null || response.hotspotId !== null);
    const h = chosenHotspot(item, response);
    const correct = !!h?.correct;
    const score = correct ? item.points : 0;
    const status = outcome(score, item.points, answered);
    const feedback = outcomeFeedback(item.feedback, status, [h?.feedback]);
    return {
      itemId: item.id, itemType: item.type, status, score, maxScore: item.points, skills: item.skills,
      parts: [{ partId: 'choice', correct, ...(answered ? { given: h?.label ?? 'outside any area' } : {}), ...(correct ? {} : { reason: answered ? ('wrong-choice' as const) : ('blank' as const) }) }],
      ...(feedback ? { feedback } : {}),
    };
  },
  validate(item) {
    const issues: ValidationIssue[] = [];
    const at = (path: string, message: string) => issues.push({ itemId: item.id, path, message });
    if (!item.prompt.trim()) at('prompt', 'Question text is empty.');
    if (!item.image) at('image', 'Choose an image.');
    else if (!item.image.decorative && !item.image.alt.trim()) at('image', 'Add alt text to the image.');
    if (!item.hotspots.some((h) => h.correct)) at('hotspots', 'Mark at least one hotspot as correct.');
    if (item.hotspots.some((h) => !h.label.trim())) at('hotspots', 'Every hotspot needs a label (used for the accessible list and reports).');
    if (item.hotspots.some((h) => h.w <= 0 || h.h <= 0 || h.x + h.w > 100.01 || h.y + h.h > 100.01)) at('hotspots', 'A hotspot has no size or extends outside the image.');
    return issues;
  },
  correctAnswers: (i) => i.hotspots.filter((h) => h.correct).map((h) => h.label),
  describeResponse(i, r) {
    if (!r || (r.point === null && r.hotspotId === null)) return '';
    return chosenHotspot(i, r)?.label ?? 'outside any area';
  },
};
