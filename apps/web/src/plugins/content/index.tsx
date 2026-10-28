import type { ContentItem } from '@ilp/core';
import { TextArea, TextField } from '../../ui/fields';
import type { ItemPlugin } from '../types';

export const contentPlugin: ItemPlugin<ContentItem, Record<string, never>> = {
  type: 'content',
  label: 'Text / instructions',
  description: 'Directions, a short passage or a transition. Not scored.',
  Editor({ item, onChange }) {
    return (
      <>
        <TextField label="Heading (optional)" value={item.title} onChange={(title) => onChange({ ...item, title })} />
        <TextArea label="Text" rows={8} value={item.body} onChange={(body) => onChange({ ...item, body })} hint="Shown exactly as typed. Blank lines start new paragraphs." />
      </>
    );
  },
  Player({ item }) {
    return (
      <div className="content-block">
        {item.title && <h3>{item.title}</h3>}
        {item.body.split(/\n{2,}/).map((p, i) => (
          <p key={i} className="preserve-lines">
            {p}
          </p>
        ))}
      </div>
    );
  },
};
