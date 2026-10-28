import { describe, expect, it } from 'vitest';
import { assignmentLink, bindStudent, brokerUrl, canHideAnswerKeys, createActivity, parseBrokerId, parseRosterCsv, redactAnswerKeys, rosterProblems } from '../src';
import { mc, tf } from './fixtures';

describe('roster CSV', () => {
  it('reads flexible headers, quoted fields and tab-separated text; never imports Google ids', () => {
    const csv = 'Student Number,Name,Email,googleSub\nS01,"Kim, Min-jun",S1@Example.com,attacker\nS02,,s2@example.com,';
    const { rows, problems } = parseRosterCsv(csv, 'cls_1');
    expect(problems).toEqual([]);
    expect(rows[0]).toMatchObject({ studentNumber: 'S01', name: 'Kim, Min-jun', email: 's1@example.com', googleSub: '' });
    expect(parseRosterCsv('number\temail\n7\tx@y.com', 'c').rows[0]?.studentNumber).toBe('7');
  });
  it('reports missing columns, bad emails and duplicates with line numbers', () => {
    expect(parseRosterCsv('a,b\n1,2', 'c').problems[0]?.message).toMatch(/student number/);
    const r = parseRosterCsv('number,email\nS1,bad\nS2,a@b.com\nS2,c@d.com', 'c');
    expect(r.problems.map((p) => p.line)).toEqual([2, 4]);
  });
  it('rosterProblems catches duplicate emails', () => {
    const base = { name: '', classId: 'c', status: 'active' as const, googleSub: '', boundAt: '' };
    expect(rosterProblems([{ ...base, studentNumber: '1', email: 'a@b.c' }, { ...base, studentNumber: '2', email: 'a@b.c' }])).toHaveLength(1);
  });
});

describe('binding students to Google accounts', () => {
  const base = { name: '', classId: 'c', status: 'active' as const, boundAt: '' };
  const rows = [{ ...base, studentNumber: 'S1', email: 'a@x.com', googleSub: '' }, { ...base, studentNumber: 'S2', email: 'b@x.com', googleSub: 'sub-b' }];
  it('binds on first verified sign-in by email', () => {
    expect(bindStudent(rows, 'c', 'sub-a', 'A@x.com', 'now')).toMatchObject({ ok: true, newlyBound: true, row: { studentNumber: 'S1', googleSub: 'sub-a' } });
  });
  it('afterwards the account id is authoritative, even if the email changes', () => {
    expect(bindStudent(rows, 'c', 'sub-b', 'renamed@x.com', 'now')).toMatchObject({ ok: true, emailChanged: true, row: { studentNumber: 'S2' } });
  });
  it('a different account with a bound email cannot take the number', () => {
    expect(bindStudent(rows, 'c', 'sub-evil', 'b@x.com', 'now')).toEqual({ ok: false, reason: 'bound-to-other-account' });
  });
  it('unknown accounts and other classes are refused', () => {
    expect(bindStudent(rows, 'c', 'z', 'z@x.com', 'now')).toEqual({ ok: false, reason: 'not-enrolled' });
    expect(bindStudent(rows, 'other', 'sub-a', 'a@x.com', 'now')).toEqual({ ok: false, reason: 'not-enrolled' });
  });
});

describe('assignments', () => {
  it('builds links and validates service ids', () => {
    const id = 'AKfycbx_abcdefghijklmnopqrstuvwxyz0123456789';
    expect(parseBrokerId(`https://script.google.com/macros/s/${id}/exec`)).toBe(id);
    expect(parseBrokerId('https://evil.example/exec')).toBeNull();
    expect(brokerUrl(id)).toBe(`https://script.google.com/macros/s/${id}/exec`);
    expect(() => brokerUrl('../../x')).toThrow();
    expect(assignmentLink('https://t.github.io/app/', 'asg_1', id)).toBe(`https://t.github.io/app/#/a/asg_1?b=${id}`);
  });
  it('redaction removes keys and disables checking; unsupported types block hiding', () => {
    const a = createActivity('x');
    a.items = [mc(), tf()];
    expect(canHideAnswerKeys(a).ok).toBe(true);
    const r = redactAnswerKeys(a);
    expect(JSON.stringify(r)).not.toMatch(/"correct":true,"text"|Mammals breathe/);
    expect(r.settings.feedbackTiming).toBe('after-release');
    a.items.push({ type: 'sequencing', id: 'itm_s', audioCue: null, prompt: '', display: 'list', steps: [], points: 1, scoring: 'per-position', feedback: {}, skills: [] });
    expect(canHideAnswerKeys(a)).toEqual({ ok: false, blocking: ['sequencing'] });
  });
});
