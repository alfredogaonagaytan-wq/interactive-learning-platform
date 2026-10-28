import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { checkMedia, createActivity, publishActivity, randomId, type Activity, type Item } from '@ilp/core';
import { ActivityPlayer } from '../src/student/ActivityPlayer';
import { ConfirmProvider } from '../src/ui/dialog';
import { listAttempts, listRecordings, purgeRecordingsOlderThan, putActivity, putAsset, putRecording, putVersion } from '../src/storage/db';
import { Editor } from '../src/teacher/Editor';
import { sampleLanguageActivity } from '../src/teacher/sample';
import { mockMediaElements, mockRecorder, unmockRecorder, wav } from './helpers';

beforeEach(() => mockMediaElements());
afterEach(() => unmockRecorder());

async function audioAsset() {
  const bytes = wav();
  const { id, mime } = await checkMedia(bytes);
  await putAsset({ id, mime, bytes, name: 'clip.wav', addedAt: new Date().toISOString() });
  return id;
}

async function play(items: Item[], configure: (a: Activity) => void = () => {}) {
  const a = createActivity('Phase 3 test');
  a.items = items;
  configure(a);
  const { version, draft } = await publishActivity(a);
  await putActivity(draft);
  await putVersion(version);
  const ui = render(<ConfirmProvider><ActivityPlayer version={version} mode="student" /></ConfirmProvider>);
  return { version, ui };
}
const sample = <T extends Item['type']>(t: T, n = 0) => sampleLanguageActivity().items.filter((i) => i.type === t)[n] as Extract<Item, { type: T }>;
const attempt = async (activityId: string) => (await listAttempts(activityId))[0]!;

describe('listening: play limits', () => {
  it('counts plays from the start, not resumes, and remembers them after a reload', async () => {
    const assetId = await audioAsset();
    const audio: Item = { type: 'audio', id: 'itm_audio', title: 'Weather report', instructions: '', audio: { assetId, transcript: 'Rain tomorrow.' }, maxPlays: 2, speeds: [0.75, 1], transcript: 'after-submit' };
    const q: Item = { type: 'true-false', id: 'itm_q', audioCue: { audioItemId: 'itm_audio', start: 0, end: 0.2 }, prompt: 'It will rain.', correct: true, trueLabel: 'True', falseLabel: 'False', points: 1, feedback: {}, skills: [] };
    const { version, ui } = await play([audio, q]);
    const user = userEvent.setup();
    const player = await screen.findByRole('group', { name: 'Weather report' });
    await user.click(within(player).getByRole('button', { name: 'Play' }));
    expect(within(player).getByText('1 play left')).toBeInTheDocument();
    await user.click(within(player).getByRole('button', { name: 'Pause' }));
    await user.click(within(player).getByRole('button', { name: 'Resume' }));
    expect(within(player).getByText('1 play left')).toBeInTheDocument(); // resuming is free
    // The question's segment shares the clip's limit
    const cue = screen.getByRole('group', { name: /Question 1 audio/ });
    await user.click(within(cue).getByRole('button', { name: 'Play this part' }));
    await waitFor(async () => expect((await attempt(version.activityId)).mediaPlays).toEqual({ itm_audio: 2 }));
    ui.unmount();
    render(<ConfirmProvider><ActivityPlayer version={version} mode="student" /></ConfirmProvider>);
    const again = await screen.findByRole('group', { name: 'Weather report' });
    expect(within(again).getByText('No plays left.')).toBeInTheDocument();
    expect(within(again).getByRole('button', { name: 'Play' })).toBeDisabled();
    // transcript hidden until submit
    expect(screen.queryByText('Rain tomorrow.')).not.toBeInTheDocument();
  });
});

describe('dictation', () => {
  it('shows a word-by-word comparison without giving away the missing words before submit', async () => {
    const assetId = await audioAsset();
    const d: Item = { type: 'dictation', id: 'itm_d', prompt: 'Write what you hear.', audio: { assetId, transcript: '' }, text: 'Plants need sunlight and water.', alternatives: [], maxPlays: 3, slowSpeed: true, typoHalf: true, match: { caseSensitive: false, punctuationSensitive: false, accentSensitive: true, equivalences: [] }, points: 5, feedback: {}, skills: [] };
    await play([d]);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('What you heard'), 'Plants need sunlite water');
    await user.click(screen.getByRole('button', { name: /^Check/ }));
    const diff = await screen.findByLabelText('Word-by-word comparison');
    expect(diff).toHaveTextContent('(…)');
    expect(diff).not.toHaveTextContent('and');
    expect(screen.getByText('Partly correct')).toBeInTheDocument();
  });
});

describe('grammar engine in the player', () => {
  it('known mistakes get an error type; unexpected answers go to teacher review', async () => {
    const passive = sample('sentence-response', 0);
    await play([passive]);
    const user = userEvent.setup();
    const box = await screen.findByLabelText('Rewrite the sentence');
    await user.type(box, 'A new species of frog was discover by scientists.');
    await user.click(screen.getByRole('button', { name: /^Check/ }));
    expect(await screen.findByText('Error type: verb form')).toBeInTheDocument();
    await user.clear(box);
    await user.type(box, 'Scientists found a frog.');
    await user.click(screen.getByRole('button', { name: /^Check/ }));
    expect(await screen.findByText('Your teacher will review this')).toBeInTheDocument();
  });

  it('teacher can test answers in the editor before publishing', async () => {
    const a = createActivity('Editor test');
    a.items = [sample('sentence-response', 1)];
    await putActivity(a);
    const user = userEvent.setup();
    render(<ConfirmProvider><Editor id={a.id} /></ConfirmProvider>);
    await user.click(await screen.findByRole('button', { name: /Q1 · Sentence/ }));
    expect(screen.getByText('1 accepted sentence (preview)')).toBeInTheDocument();
    const tester = screen.getByLabelText('Try a student answer');
    await user.type(tester, 'The results of the experiment is surprising.');
    expect(await screen.findByText(/error type: subject-verb agreement/)).toBeInTheDocument();
    await user.clear(tester);
    await user.type(tester, 'The results surprised everyone.');
    expect(await screen.findByText('Sent to you for review')).toBeInTheDocument();
  });
});

describe('sentence builder', () => {
  it('builds with taps and reorders with arrow keys; Delete removes', async () => {
    const sb = { ...sample('sentence-builder'), distractors: [] };
    await play([sb]);
    const user = userEvent.setup();
    const bank = await screen.findByRole('group', { name: 'Word cards' });
    for (const w of ['the samples', 'near', 'were collected', 'the river', 'last week']) await user.click(within(bank).getByRole('button', { name: `Add “${w}”` }));
    const line = screen.getByRole('group', { name: 'Your sentence' });
    const near = within(line).getByRole('button', { name: /^near, word 2/ });
    near.focus();
    await user.keyboard('{ArrowRight}');
    await waitFor(() => expect(within(line).getAllByRole('button').map((b) => b.textContent)).toEqual(['the samples', 'were collected', 'near', 'the river', 'last week']));
    await user.click(screen.getByRole('button', { name: /^Check/ }));
    expect(await screen.findByText('Correct')).toBeInTheDocument();
    within(line).getByRole('button', { name: /^last week/ }).focus();
    await user.keyboard('{Delete}');
    expect(within(bank).getByRole('button', { name: 'Add “last week”' })).toBeInTheDocument();
  });
});

describe('speaking practice', () => {
  const speakItem = (): Extract<Item, { type: 'speaking' }> => ({ ...sample('speaking'), ttsFallback: false, modelBeforeRecording: false, submission: 'optional', targets: [{ id: 't1', text: 'The results were surprising.', focus: '', modelAudio: null }] });

  it('records, lists, selects and self-rates; unselected takes are deleted on submit', async () => {
    mockRecorder();
    const { version } = await play([speakItem()]);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Record' }));
    await user.click(await screen.findByRole('button', { name: /^Stop/ }));
    await user.click(await screen.findByRole('button', { name: 'Record again' }));
    await user.click(await screen.findByRole('button', { name: /^Stop/ }));
    await waitFor(async () => expect(await listRecordings()).toHaveLength(2));
    expect(await screen.findAllByLabelText(/Your recording/)).toHaveLength(2);
    await user.click(screen.getAllByRole('radio', { name: 'Submit this one' })[1]!);
    await user.click(screen.getByRole('radio', { name: 'I’m confident' }));
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Submit' }));
    await screen.findByRole('heading', { name: 'Your results' });
    await waitFor(async () => expect(await listRecordings()).toHaveLength(1));
    const a = await attempt(version.activityId);
    const t = (a.responses[version.activity.items[0]!.id] as { targets: Record<string, { selectedRecordingId: string; selfRating: number }> }).targets.t1!;
    expect((await listRecordings())[0]?.id).toBe(t.selectedRecordingId);
    expect(t.selfRating).toBe(3);
    expect(screen.getByText(/not for pronunciation accuracy/)).toBeInTheDocument();
  });

  it('explains a blocked microphone and offers upload instead', async () => {
    mockRecorder({ deny: true });
    await play([speakItem()]);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Record' }));
    expect(await screen.findByText(/Microphone access is blocked/)).toBeInTheDocument();
    expect(screen.getByText('Upload a recording…')).toBeInTheDocument();
  });

  it('falls back to upload where recording is unsupported', async () => {
    unmockRecorder();
    await play([speakItem()]);
    expect(await screen.findByRole('button', { name: 'Record' })).toBeDisabled();
    expect(screen.getByText('Upload a recording…')).toBeInTheDocument();
  });

  it('speech-to-text is hidden unless enabled, then needs consent and is labelled as not a score', async () => {
    mockRecorder();
    class FakeSR {
      lang = ''; interimResults = false; maxAlternatives = 1;
      onresult: ((e: unknown) => void) | null = null; onerror: unknown = null; onend: unknown = null;
      start() { setTimeout(() => this.onresult?.({ results: [[{ transcript: 'the results were surprising', confidence: 0.9 }]] }), 0); }
      stop() {}
    }
    (window as unknown as { webkitSpeechRecognition: unknown }).webkitSpeechRecognition = FakeSR;
    try {
      const off = await play([speakItem()]);
      expect(screen.queryByText(/speech-to-text/i)).not.toBeInTheDocument();
      off.ui.unmount();
      await play([{ ...speakItem(), id: 'itm_sp2', speechToText: true }]);
      const user = userEvent.setup();
      await user.click(await screen.findByText('Check with speech-to-text (optional)'));
      expect(screen.getByText(/may be sent to the browser maker/)).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: /I understand/ }));
      await user.click(screen.getByRole('button', { name: 'Say it for speech-to-text' }));
      expect(await screen.findByText(/Speech-to-text heard: “the results were surprising”\. That matches the words\./)).toBeInTheDocument();
    } finally {
      delete (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
    }
  });
});

describe('recording retention', () => {
  it('purges recordings older than the configured age', async () => {
    const old = new Date(Date.now() - 20 * 86_400_000).toISOString();
    const base = { attemptId: 'att_x', activityId: 'act_x', itemId: 'itm', targetId: 't', mime: 'audio/webm', bytes: new Uint8Array([1]), durationMs: 1000 };
    await putRecording({ ...base, id: 'r_old', createdAt: old });
    await putRecording({ ...base, id: 'r_new', createdAt: new Date().toISOString() });
    await act(async () => expect(await purgeRecordingsOlderThan(14)).toBe(1));
    expect((await listRecordings()).map((r) => r.id)).toEqual(['r_new']);
  });
});

void randomId;
