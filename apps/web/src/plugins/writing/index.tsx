import type { WritingItem, WritingResponse } from '@ilp/core';
import { NumberField, Select, SkillsField, TextField } from '../../ui/fields';
import { WritingPanel, WritingTaskEditor } from '../../reading/Writing';
import type { ItemPlugin } from '../types';

const EMPTY: WritingResponse = { sections: {}, successChecks: {}, rubricSelf: {} };

export const writingPlugin: ItemPlugin<WritingItem, WritingResponse> = {
  type: 'writing',
  label: 'Structured writing',
  description: 'CER, TCTAC, Toulmin or your own framework, with sentence starters, checks and a rubric.',
  Editor({ item, onChange }) {
    return (
      <>
        <TextField label="Title (optional)" value={item.title} onChange={(title) => onChange({ ...item, title })} />
        <WritingTaskEditor task={item.task} onChange={(task) => onChange({ ...item, task })} />
        <Select label="Scoring" value={item.scoring} onChange={(scoring) => onChange({ ...item, scoring })} options={[
          { value: 'teacher-review', label: 'I will review and score (rubric if provided)' },
          { value: 'completion', label: 'Points for meeting the checklist requirements' },
          { value: 'none', label: 'No points' },
        ]} />
        {item.scoring !== 'none' && !(item.scoring === 'teacher-review' && item.task.rubric.length) && <NumberField label="Points" value={item.points} min={0} max={1000} onChange={(v) => onChange({ ...item, points: v ?? 0 })} />}
        <SkillsField value={item.skills} onChange={(skills) => onChange({ ...item, skills })} />
      </>
    );
  },
  Player({ item, response, onChange, disabled }) {
    const value: WritingResponse = { ...EMPTY, ...(response as Partial<WritingResponse>) };
    return (
      <div className="writing-item">
        {item.title && <h3>{item.title}</h3>}
        <WritingPanel task={item.task} value={value} disabled={disabled} onChange={onChange} />
      </div>
    );
  },
};
