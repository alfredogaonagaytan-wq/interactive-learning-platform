import { z } from 'zod';
import { AudioCueField, FeedbackSchema, IdSchema, ImageRefSchema, PointsSchema, ShortTextSchema, SkillTagsSchema, TextSchema } from '../schema/common';
import { roundScore, type PartResult, type ValidationIssue } from '../grading/types';
import { outcome, outcomeFeedback, penalisedFraction, type ItemDefinition } from './definition';

const Percent = z.number().min(0).max(100);

/**
 * Drag and drop into zones. With a background image, zones are rectangles in
 * percent coordinates (image labelling). Without one, zones render as labelled
 * boxes (sorting into categories). Draggables with no correct zone are
 * distractors; placing them anywhere counts as a wrong placement.
 */
export const DropZoneSchema = z.object({
  id: IdSchema,
  label: ShortTextSchema,
  showLabel: z.boolean().default(true),
  x: Percent.default(0),
  y: Percent.default(0),
  w: Percent.default(20),
  h: Percent.default(15),
  /** null = unlimited. */
  capacity: z.number().int().min(1).max(50).nullable().default(null),
});
export const DraggableSchema = z.object({
  id: IdSchema,
  text: ShortTextSchema.default(''),
  image: ImageRefSchema.nullable().default(null),
  correctZoneIds: z.array(IdSchema).default([]),
});
export const DragDropItemSchema = z.object({
  type: z.literal('drag-drop'),
  id: IdSchema,
  /** Optional link to an audio clip in this activity (listening tasks). */
  audioCue: AudioCueField,
  prompt: TextSchema.default(''),
  background: ImageRefSchema.nullable().default(null),
  zones: z.array(DropZoneSchema).max(40),
  draggables: z.array(DraggableSchema).max(60),
  points: PointsSchema.default(1),
  scoring: z.enum(['per-item', 'all-or-nothing']).default('per-item'),
  feedback: FeedbackSchema.default({}),
  skills: SkillTagsSchema,
});
export type DragDropItem = z.infer<typeof DragDropItemSchema>;
export type DropZone = z.infer<typeof DropZoneSchema>;
export type Draggable = z.infer<typeof DraggableSchema>;
/** placements: draggableId -> zoneId */
export interface DragDropResponse {
  placements: Record<string, string>;
}

const label = (d: Draggable) => d.text || d.image?.alt || 'image';

export const dragDropDefinition: ItemDefinition<DragDropItem, DragDropResponse> = {
  type: 'drag-drop',
  label: 'Drag and drop',
  scorable: true,
  emptyResponse: () => ({ placements: {} }),
  isAnswered: (_i, r) => !!r && Object.keys(r.placements).length > 0,
  maxScore: (i) => i.points,
  assets: (i) => [...(i.background ? [i.background.assetId] : []), ...i.draggables.flatMap((d) => (d.image ? [d.image.assetId] : []))],
  grade(item, response) {
    const zones = new Set(item.zones.map((z) => z.id));
    const placements = response?.placements ?? {};
    let right = 0;
    let wrong = 0;
    const parts: PartResult[] = item.draggables.map((d) => {
      const zone = placements[d.id];
      const placed = zone !== undefined && zones.has(zone);
      const shouldPlace = d.correctZoneIds.length > 0;
      if (!placed) return { partId: d.id, correct: !shouldPlace, ...(shouldPlace ? { reason: 'blank' as const } : {}) };
      const ok = d.correctZoneIds.includes(zone);
      if (ok) right++;
      else wrong++;
      return { partId: d.id, correct: ok, given: item.zones.find((z) => z.id === zone)?.label ?? zone, ...(ok ? {} : { reason: 'wrong-choice' as const }) };
    });
    const targets = item.draggables.filter((d) => d.correctZoneIds.length > 0).length;
    const raw = item.scoring === 'all-or-nothing' ? (right === targets && wrong === 0 ? item.points : 0) : item.points * penalisedFraction(right, wrong, targets);
    const score = roundScore(raw);
    const status = outcome(score, item.points, right + wrong > 0);
    const feedback = outcomeFeedback(item.feedback, status);
    return { itemId: item.id, itemType: item.type, status, score, maxScore: item.points, parts, skills: item.skills, ...(feedback ? { feedback } : {}) };
  },
  validate(item) {
    const issues: ValidationIssue[] = [];
    const at = (path: string, message: string) => issues.push({ itemId: item.id, path, message });
    if (item.zones.length === 0) at('zones', 'Add at least one drop zone.');
    if (item.zones.some((z) => !z.label.trim())) at('zones', 'Every drop zone needs a label (used by screen readers even if hidden).');
    if (!item.draggables.some((d) => d.correctZoneIds.length > 0)) at('draggables', 'At least one draggable needs a correct zone.');
    if (item.draggables.some((d) => !d.text.trim() && !d.image)) at('draggables', 'A draggable has no text or image.');
    if (item.draggables.some((d) => d.image && !d.text.trim() && !d.image.alt.trim())) at('draggables', 'Add alt text to image draggables.');
    if (item.background && !item.background.decorative && !item.background.alt.trim()) at('background', 'Add alt text to the background image.');
    if (item.background && item.zones.some((z) => z.x + z.w > 100.01 || z.y + z.h > 100.01)) at('zones', 'A zone extends outside the image.');
    const zoneIds = new Set(item.zones.map((z) => z.id));
    if (item.draggables.some((d) => d.correctZoneIds.some((z) => !zoneIds.has(z)))) at('draggables', 'A draggable refers to a zone that no longer exists.');
    for (const z of item.zones) {
      const mustGo = item.draggables.filter((d) => d.correctZoneIds.length === 1 && d.correctZoneIds[0] === z.id).length;
      if (z.capacity !== null && mustGo > z.capacity) at('zones', `Zone “${z.label}” holds ${z.capacity} but ${mustGo} draggables can only go there.`);
    }
    return issues;
  },
  correctAnswers: (i) => i.draggables.filter((d) => d.correctZoneIds.length).map((d) => `${label(d)} → ${d.correctZoneIds.map((z) => i.zones.find((x) => x.id === z)?.label ?? '?').join(' or ')}`),
  describeResponse(i, r) {
    return i.draggables
      .filter((d) => r?.placements[d.id])
      .map((d) => `${label(d)} → ${i.zones.find((z) => z.id === r!.placements[d.id])?.label ?? '?'}`)
      .join('; ');
  },
};
