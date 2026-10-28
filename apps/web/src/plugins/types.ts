import type { ComponentType } from 'react';
import type { Activity, Item, ItemResult, ItemType } from '@ilp/core';

export interface EditorProps<I extends Item> {
  item: I;
  onChange: (item: I) => void;
  language: string;
}

export interface PlayerProps<I extends Item, R> {
  item: I;
  response: R;
  onChange: (response: R) => void;
  /** Locked after submit or while results are shown. */
  disabled: boolean;
  /** Result to display (after Check or Submit). */
  result?: ItemResult | undefined;
  /** Teacher preview: highlight the answer key. */
  showKey: boolean;
  /** Stable per attempt; used for deterministic choice shuffling. */
  seed: string;
  /** Accessible name prefix, e.g. "Question 3". */
  label: string;
  /** Student revealed the hint for this item (shows per-gap hints, etc.). */
  hintsShown?: boolean;
  /** Attempt-level services (audio play counts, recordings). Absent in isolated renders. */
  ctx?: PlayerContext;
}

export interface PlayerContext {
  activity: Activity;
  attemptId: string;
  /** "student", "preview" or "teacher-preview". */
  mode: string;
  submitted: boolean;
  /** Correct answers may be shown (teacher's answer-reveal setting). */
  reveal: boolean;
  plays: (key: string) => number;
  countPlay: (key: string) => void;
}

/** UI half of a question-type plugin. The grading half lives in @ilp/core. */
export interface ItemPlugin<I extends Item = Item, R = unknown> {
  type: ItemType;
  label: string;
  description: string;
  Editor: ComponentType<EditorProps<I>>;
  Player: ComponentType<PlayerProps<I, R>>;
}
