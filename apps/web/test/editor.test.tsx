import { describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createActivity } from '@ilp/core';
import { Editor } from '../src/teacher/Editor';
import { ConfirmProvider } from '../src/ui/dialog';
import { getActivity, listVersions, putActivity } from '../src/storage/db';

async function setup() {
  const a = createActivity('My quiz');
  await putActivity(a);
  render(
    <ConfirmProvider>
      <Editor id={a.id} />
    </ConfirmProvider>,
  );
  await screen.findByRole('heading', { name: 'Details' });
  return a;
}

describe('Teacher editor', () => {
  it('blocks publishing until the activity is complete, and points to the problem', async () => {
    const a = await setup();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Publish' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Add at least one question/);
    expect(await listVersions(a.id)).toEqual([]);
  });

  it('builds a multiple-choice question without JSON and publishes it', async () => {
    const a = await setup();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Multiple choice/ }));
    await user.type(screen.getByLabelText('Question'), 'What is H2O?');
    await user.type(screen.getByLabelText('Choice 1 text'), 'Water');
    await user.type(screen.getByLabelText('Choice 2 text'), 'Salt');
    await user.click(screen.getByRole('button', { name: 'Publish' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Publish' }));
    expect(await screen.findByText(/Published version 1/)).toBeInTheDocument();
    const [v] = await listVersions(a.id);
    expect(v?.activity.items[0]).toMatchObject({ type: 'multiple-choice', prompt: 'What is H2O?' });
  });

  it('parses fill-in-the-blank markup with alternatives into blanks', async () => {
    const a = await setup();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Fill in the blanks/ }));
    const box = screen.getByLabelText('Text with blanks');
    await user.click(box);
    await user.paste('She [went | was going] home.');
    expect(await screen.findByText('1 blank found')).toBeInTheDocument();
    await waitFor(async () => {
      const saved = await getActivity(a.id);
      const item = saved?.items[0];
      expect(item?.type === 'fill-blanks' && item.segments.find((s) => s.kind === 'blank')).toMatchObject({ answers: ['went', 'was going'] });
    });
  });

  it('autosaves draft edits', async () => {
    const a = await setup();
    const user = userEvent.setup();
    const title = screen.getByLabelText('Title');
    await user.clear(title);
    await user.type(title, 'Cells and organelles');
    await waitFor(async () => expect((await getActivity(a.id))?.title).toBe('Cells and organelles'), { timeout: 2000 });
  });

  it('reorders items with buttons (keyboard alternative to drag-and-drop)', async () => {
    const a = await setup();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /True \/ false/ }));
    await user.click(screen.getByText('+ Add item'));
    await user.click(screen.getByRole('button', { name: /Text \/ instructions/ }));
    await user.click(screen.getByRole('button', { name: 'Move item 2 up' }));
    await waitFor(async () => expect((await getActivity(a.id))?.items.map((i) => i.type)).toEqual(['content', 'true-false']), { timeout: 2000 });
  });
});
