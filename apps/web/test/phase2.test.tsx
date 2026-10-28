import { describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { checkMedia, createActivity, publishActivity, randomId, type Activity, type Item, type PublishedVersion } from '@ilp/core';
import { ActivityPlayer } from '../src/student/ActivityPlayer';
import { ConfirmProvider } from '../src/ui/dialog';
import { listAttempts, putActivity, putAsset, putVersion } from '../src/storage/db';
import { sampleSortingActivity } from '../src/teacher/sample';

import { PNG } from './helpers';

async function play(items: Item[], configure: (a: Activity) => void = () => {}) {
  const a = createActivity('Phase 2 test');
  a.items = items;
  configure(a);
  const { version, draft } = await publishActivity(a);
  await putActivity(draft);
  await putVersion(version);
  render(<ConfirmProvider><ActivityPlayer version={version} mode="student" /></ConfirmProvider>);
  return version;
}

const item = <T extends Item['type']>(type: T) => sampleSortingActivity().items.find((i) => i.type === type)! as Extract<Item, { type: T }>;
const saved = async (v: PublishedVersion) => (await listAttempts(v.activityId))[0]!;

describe('drag the words (keyboard and tap alternatives)', () => {
  it('pick up with Enter, place with Enter, swap when the gap is full', async () => {
    const dw = item('drag-words');
    const v = await play([dw]);
    const user = userEvent.setup();
    const bank = await screen.findByRole('group', { name: 'Words to place' });
    const sunlight = within(bank).getByRole('button', { name: 'sunlight' });
    sunlight.focus();
    await user.keyboard('{Enter}');
    expect(sunlight).toHaveAttribute('aria-pressed', 'true');
    const gap2 = screen.getByRole('button', { name: /^Gap 2 of 3: empty/ });
    gap2.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('button', { name: /^Gap 2 of 3: sunlight/ })).toBeInTheDocument();
    // Tap a different word into the same gap: the first one returns to the bank.
    await user.click(within(bank).getByRole('button', { name: 'soil' }));
    await user.click(screen.getByRole('button', { name: /^Gap 2 of 3: sunlight/ }));
    expect(screen.getByRole('button', { name: /^Gap 2 of 3: soil/ })).toBeInTheDocument();
    expect(within(bank).getByRole('button', { name: 'sunlight' })).toBeInTheDocument();
    await waitFor(async () => expect(Object.keys(((await saved(v)).responses[dw.id] as { placements: object }).placements)).toHaveLength(1));
  });

  it('Escape cancels a pick-up', async () => {
    await play([item('drag-words')]);
    const user = userEvent.setup();
    const t = within(await screen.findByRole('group', { name: 'Words to place' })).getByRole('button', { name: 'soil' });
    await user.click(t);
    await user.keyboard('{Escape}');
    expect(t).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('matching', () => {
  it('places cards by tapping and grades on Check', async () => {
    const m = item('matching');
    await play([m]);
    const user = userEvent.setup();
    const bank = await screen.findByRole('group', { name: 'Cards to match' });
    for (const p of m.pairs) {
      await user.click(within(bank).getByRole('button', { name: p.right }));
      await user.click(screen.getByRole('button', { name: new RegExp(`^Match for “${p.left}”`) }));
    }
    await user.click(screen.getByRole('button', { name: /^Check/ }));
    expect(await screen.findByText('Correct')).toBeInTheDocument();
  });
});

describe('drag and drop zones', () => {
  it('sorts cards into categories and respects capacity', async () => {
    const dd = item('drag-drop');
    dd.zones[0]!.capacity = 2;
    await play([dd]);
    const user = userEvent.setup();
    const bank = await screen.findByRole('group', { name: 'Cards' });
    await user.click(within(bank).getByRole('button', { name: 'oak tree' }));
    await user.click(screen.getByRole('button', { name: 'Place oak tree in Producers' }));
    const producers = screen.getByRole('group', { name: 'Producers' });
    expect(within(producers).getByRole('button', { name: /oak tree, in Producers/ })).toBeInTheDocument();
    await user.click(within(bank).getByRole('button', { name: 'rabbit' }));
    await user.click(screen.getByRole('button', { name: 'Place rabbit in Producers' }));
    await user.click(within(bank).getByRole('button', { name: 'seaweed' }));
    await user.click(screen.getByRole('button', { name: 'Place seaweed in Producers' }));
    expect(await screen.findByText('Producers is full.')).toBeInTheDocument();
    // A placed card can be sent back to the bank
    await user.click(within(producers).getByRole('button', { name: /oak tree/ }));
    await user.click(screen.getByRole('button', { name: /Return “oak tree” to bank/ }));
    expect(within(bank).getByRole('button', { name: 'oak tree' })).toBeInTheDocument();
  });
});

describe('sequencing', () => {
  it('reorders with buttons and keeps focus on the moved item', async () => {
    const seq = { ...item('sequencing'), steps: item('sequencing').steps.slice(0, 2) };
    const v = await play([seq]);
    const user = userEvent.setup();
    const list = within(await screen.findByRole('group', { name: /Put the food chain/ })).getByRole('list');
    const first = () => within(list).getAllByRole('listitem')[0]!.textContent;
    const before = first();
    await user.click(within(list).getAllByRole('button', { name: /down/ })[0]!);
    expect(first()).not.toBe(before);
    await waitFor(() => expect(document.activeElement?.getAttribute('aria-label') ?? '').toMatch(/now 2 of 2/));
    await user.click(screen.getByRole('button', { name: /^Check/ }));
    await waitFor(async () => expect(((await saved(v)).responses[seq.id] as { order: string[] }).order).toHaveLength(2));
  });
});

describe('mark the words', () => {
  it('toggles words with aria-pressed', async () => {
    await play([item('mark-words')]);
    const user = userEvent.setup();
    const frog = await screen.findByRole('button', { name: 'frog' });
    await user.click(frog);
    expect(frog).toHaveAttribute('aria-pressed', 'true');
    await user.click(frog);
    expect(frog).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('dropdown cloze', () => {
  it('selects options with the keyboard', async () => {
    await play([item('dropdown-cloze')]);
    const user = userEvent.setup();
    const gap = await screen.findByRole('combobox', { name: 'Gap 1 of 2' });
    await user.selectOptions(gap, 'breaks');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Gap 2 of 2' }), 'are');
    await user.click(screen.getByRole('button', { name: /^Check/ }));
    expect(await screen.findByText('Correct')).toBeInTheDocument();
  });
});

describe('find the hotspot', () => {
  async function hotspotItem(): Promise<Item> {
    const { id, mime } = await checkMedia(PNG);
    await putAsset({ id, mime, bytes: PNG, name: 'cell.png', addedAt: new Date().toISOString() });
    return {
      type: 'hotspot', id: randomId('itm'), prompt: 'Click the nucleus', image: { assetId: id, alt: 'Diagram of an animal cell', decorative: false }, allowListAlternative: true, points: 1, feedback: {}, skills: [],
      hotspots: [
        { id: 'h1', label: 'Nucleus', shape: 'ellipse', x: 35, y: 35, w: 30, h: 30, correct: true },
        { id: 'h2', label: 'Membrane', shape: 'rect', x: 0, y: 0, w: 100, h: 10, correct: false },
      ],
    };
  }
  it('keyboard crosshair: arrows move, Enter chooses', async () => {
    const v = await play([await hotspotItem()]);
    const user = userEvent.setup();
    const stage = await screen.findByRole('button', { name: /Diagram of an animal cell\. Crosshair at 50% across, 50% down/ });
    stage.focus();
    await user.keyboard('{ArrowUp}{ArrowUp}{Enter}');
    await waitFor(async () => expect((await saved(v)).responses[v.activity.items[0]!.id]).toEqual({ point: { x: 50, y: 40 }, hotspotId: null }));
    await user.click(screen.getByRole('button', { name: /^Check/ }));
    expect(await screen.findByText('Correct')).toBeInTheDocument();
  });
  it('list alternative for screen-reader users', async () => {
    await play([await hotspotItem()]);
    const user = userEvent.setup();
    await user.click(await screen.findByText('Choose from a list instead'));
    await user.click(screen.getByRole('radio', { name: 'Membrane' }));
    await user.click(screen.getByRole('button', { name: /^Check/ }));
    expect(await screen.findByText('Not correct')).toBeInTheDocument();
  });
});

describe('question pools in the player', () => {
  it('shows only the drawn questions and stores the selection with the attempt', async () => {
    const qs: Item[] = Array.from({ length: 5 }, (_, i) => ({ type: 'true-false', id: `itm_q${i}`, prompt: `Statement ${i}`, correct: true, trueLabel: 'True', falseLabel: 'False', points: 1, feedback: {}, skills: [] }));
    const v = await play(qs, (a) => { a.pools = [{ id: 'pol_a', name: 'Facts', draw: 2, itemIds: qs.map((q) => q.id) }]; });
    expect(await screen.findAllByRole('group', { name: /Statement/ })).toHaveLength(2);
    const a = await saved(v);
    expect(a.presentedItemIds).toHaveLength(2);
  });
});
