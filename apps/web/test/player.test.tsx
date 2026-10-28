import { describe, expect, it } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ActivityPlayer } from '../src/student/ActivityPlayer';
import { ConfirmProvider } from '../src/ui/dialog';
import { listAttempts } from '../src/storage/db';
import { published, testActivity } from './helpers';
import type { PublishedVersion } from '@ilp/core';

function renderPlayer(v: PublishedVersion, mode: 'student' | 'preview' | 'teacher-preview' = 'student') {
  return render(
    <ConfirmProvider>
      <ActivityPlayer version={v} mode={mode} />
    </ConfirmProvider>,
  );
}

const savedLocally = () => screen.findByText(/Saved on this device/);

describe('ActivityPlayer', () => {
  it('autosaves typed answers and restores them after a reload', async () => {
    const v = await published();
    const user = userEvent.setup();
    const first = renderPlayer(v);
    const blank = await screen.findByRole('textbox', { name: /Blank 1 of 3/ });
    await user.type(blank, 'went');
    await waitFor(async () => {
      const [a] = await listAttempts(v.activityId, v.version, 'student');
      expect((a?.responses as Record<string, { values: Record<string, string> }>)[v.activity.items[1]!.id]?.values).toMatchObject({ [blankId(v, 0)]: 'went' });
    });
    first.unmount(); // simulate closing the tab
    renderPlayer(v);
    expect(await screen.findByRole('textbox', { name: /Blank 1 of 3/ })).toHaveValue('went');
    expect(await savedLocally()).toBeInTheDocument();
  });

  it('can be completed with the keyboard only', async () => {
    const v = await published();
    const user = userEvent.setup();
    renderPlayer(v);
    const group = await screen.findByRole('group', { name: /Which sentence is correct/ });
    const radios = within(group).getAllByRole('radio');
    radios[0]!.focus();
    await user.keyboard('{ArrowDown}'); // arrow keys move selection within a radio group
    expect(radios[1]).toBeChecked();
    // True/false via keyboard
    const tf = screen.getByRole('group', { name: /buyed/ });
    within(tf).getAllByRole('radio')[1]!.focus();
    await user.keyboard(' ');
    expect(within(tf).getAllByRole('radio')[1]).toBeChecked();
    // Check button reachable and announces feedback
    const checks = screen.getAllByRole('button', { name: /^Check/ });
    checks[1]!.focus();
    await user.keyboard('{Enter}');
    expect(await screen.findAllByText('Correct')).not.toHaveLength(0);
  });

  it('submits, shows results and respects the attempt limit', async () => {
    const v = await published(testActivity({ maxAttempts: 1, answerReveal: 'after-submit' }));
    const user = userEvent.setup();
    renderPlayer(v);
    await user.type(await screen.findByRole('textbox', { name: /Blank 1 of 3/ }), 'goed');
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(/unanswered/);
    await user.click(within(dialog).getByRole('button', { name: 'Submit' }));
    expect(await screen.findByRole('heading', { name: 'Your results' })).toBeInTheDocument();
    expect(screen.getAllByText(/Accepted answer/).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /Try again/ })).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /Blank 1 of 3/ })).toBeDisabled();
    const [a] = await listAttempts(v.activityId, v.version, 'student');
    expect(a?.status).toBe('submitted');
  });

  it('hides results until release when configured', async () => {
    const v = await published(testActivity({ feedbackTiming: 'after-release' }));
    const user = userEvent.setup();
    renderPlayer(v);
    expect(screen.queryByRole('button', { name: /^Check/ })).not.toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'Submit' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Submit' }));
    expect(await screen.findByRole('heading', { name: 'Submitted' })).toBeInTheDocument();
    expect(screen.queryByText(/Accepted answer/)).not.toBeInTheDocument();
    expect(screen.getByText(/teacher will release/)).toBeInTheDocument();
  });

  it('limits checks per item', async () => {
    const v = await published(testActivity({ checksPerItem: 1 }));
    const user = userEvent.setup();
    renderPlayer(v);
    const [check] = await screen.findAllByRole('button', { name: /Check \(1 left\)/ });
    await user.click(check!);
    await waitFor(() => expect(screen.getAllByRole('button', { name: /^Check/ })).toHaveLength(3));
  });

  it('teacher preview shows the answer key and saves nothing', async () => {
    const v = await published();
    renderPlayer(v, 'teacher-preview');
    expect((await screen.findAllByText('Answer key')).length).toBeGreaterThan(0);
    expect(screen.getByText('went')).toBeInTheDocument();
    expect(await listAttempts(v.activityId)).toEqual([]);
  });

  it('keeps working while offline and says so', async () => {
    const v = await published();
    const user = userEvent.setup();
    renderPlayer(v);
    const original = Object.getOwnPropertyDescriptor(Navigator.prototype, 'onLine');
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
    act(() => void window.dispatchEvent(new Event('offline')));
    expect(await screen.findByText(/Offline — work is kept on this device/)).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: /Blank 2 of 3/ }), 'saw');
    await waitFor(async () => expect(JSON.stringify((await listAttempts(v.activityId))[0]?.responses)).toContain('saw'));
    if (original) Object.defineProperty(navigator, 'onLine', original);
    delete (navigator as { onLine?: boolean }).onLine;
  });
});

function blankId(v: PublishedVersion, n: number): string {
  const item = v.activity.items[1]!;
  if (item.type !== 'fill-blanks') throw new Error('fixture changed');
  return item.segments.filter((s) => s.kind === 'blank')[n]!.id as string;
}

describe('write-ahead journal', () => {
  it('recovers keystrokes that never reached IndexedDB (tab closed mid-save)', async () => {
    const v = await published();
    const first = renderPlayer(v);
    await screen.findByRole('textbox', { name: /Blank 1 of 3/ });
    const [stored] = await listAttempts(v.activityId, v.version, 'student');
    first.unmount();
    // Simulate: journal has a newer change than the database.
    const { journalWrite } = await import('../src/storage/journal');
    const item = v.activity.items[1]!;
    journalWrite({ ...stored!, responses: { [item.id]: { values: { [blankId(v, 0)]: 'went' } } }, updatedAt: new Date(Date.now() + 1000).toISOString() });
    renderPlayer(v);
    expect(await screen.findByRole('textbox', { name: /Blank 1 of 3/ })).toHaveValue('went');
    await waitFor(async () => expect(JSON.stringify((await listAttempts(v.activityId))[0]?.responses)).toContain('went'));
  });
});
