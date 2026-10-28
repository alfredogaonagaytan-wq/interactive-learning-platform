import { z } from 'zod';

/**
 * Private class roster (lives in the teacher's Google Sheet via the broker; never
 * inside an activity package). Names are optional and teacher-only.
 */
export const RosterRowSchema = z.object({
  studentNumber: z.string().trim().min(1).max(40).regex(/^[\p{L}\p{N}_.-]+$/u, 'Use letters, numbers, dots, dashes or underscores'),
  name: z.string().trim().max(120).default(''),
  email: z.string().trim().toLowerCase().email().max(254),
  classId: z.string().max(64),
  status: z.enum(['active', 'withdrawn']).default('active'),
  /** Stable Google account id, bound on the student's first verified sign-in. Never set by the student. */
  googleSub: z.string().max(64).default(''),
  boundAt: z.string().max(40).default(''),
});
export type RosterRow = z.infer<typeof RosterRowSchema>;

export const ROSTER_COLUMNS = ['studentNumber', 'name', 'email', 'classId', 'status', 'googleSub', 'boundAt'] as const;

export interface RosterProblem {
  line: number;
  message: string;
}

/** Validate a roster: unique student numbers and emails within a class. */
export function rosterProblems(rows: RosterRow[]): RosterProblem[] {
  const out: RosterProblem[] = [];
  const nums = new Map<string, number>();
  const emails = new Map<string, number>();
  rows.forEach((r, i) => {
    const kNum = `${r.classId}|${r.studentNumber.toLowerCase()}`;
    const kMail = `${r.classId}|${r.email}`;
    if (nums.has(kNum)) out.push({ line: i + 1, message: `Student number ${r.studentNumber} is used twice (also line ${nums.get(kNum)}).` });
    if (emails.has(kMail)) out.push({ line: i + 1, message: `${r.email} appears twice (also line ${emails.get(kMail)}).` });
    nums.set(kNum, i + 1);
    emails.set(kMail, i + 1);
  });
  return out;
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',' || c === '\t') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/**
 * Parse a roster CSV (or tab-separated text pasted from a spreadsheet).
 * Needs columns for student number and email (any order, header names flexible);
 * name and status are optional. googleSub can never be imported.
 */
export function parseRosterCsv(text: string, classId: string): { rows: RosterRow[]; problems: RosterProblem[] } {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return { rows: [], problems: [{ line: 0, message: 'The file is empty.' }] };
  const header = splitCsvLine(lines[0]!).map((h) => h.toLowerCase().replace(/[^a-z]/g, ''));
  const col = (...names: string[]) => header.findIndex((h) => names.includes(h));
  const iNum = col('studentnumber', 'number', 'id', 'studentid', 'no');
  const iMail = col('email', 'emailaddress', 'googleemail', 'mail');
  const iName = col('name', 'studentname', 'fullname');
  const iStatus = col('status', 'enrollment', 'enrolment');
  if (iNum < 0 || iMail < 0) return { rows: [], problems: [{ line: 1, message: 'The first row must name the columns, including “student number” and “email”.' }] };
  const rows: RosterRow[] = [];
  const lineOf: number[] = [];
  const problems: RosterProblem[] = [];
  lines.slice(1).forEach((l, k) => {
    const c = splitCsvLine(l);
    const parsed = RosterRowSchema.safeParse({
      studentNumber: c[iNum] ?? '', email: c[iMail] ?? '', name: iName >= 0 ? (c[iName] ?? '') : '', classId,
      status: iStatus >= 0 && /withdr|inactive|left/i.test(c[iStatus] ?? '') ? 'withdrawn' : 'active',
    });
    if (parsed.success) {
      rows.push(parsed.data);
      lineOf.push(k + 2);
    }
    else problems.push({ line: k + 2, message: parsed.error.issues.map((x) => `${x.path.join('.')}: ${x.message}`).join('; ') });
  });
  // rosterProblems counts parsed rows; map back to the file's own line numbers.
  const dupes = rosterProblems(rows).map((p) => ({ line: lineOf[p.line - 1] ?? p.line, message: p.message.replace(/\(also line (\d+)\)/, (_m, n: string) => `(also line ${lineOf[Number(n) - 1] ?? n})`) }));
  return { rows, problems: [...problems, ...dupes].sort((a, b) => a.line - b.line) };
}

export type BindResult =
  | { ok: true; row: RosterRow; newlyBound: boolean; emailChanged: boolean }
  | { ok: false; reason: 'not-enrolled' | 'withdrawn' | 'bound-to-other-account' };

/**
 * Decide whether a verified Google account may act as a roster student.
 * First verified sign-in binds the account's `sub`; afterwards the `sub` is
 * authoritative, so a changed email address cannot hijack a student number.
 */
export function bindStudent(rows: RosterRow[], classId: string, sub: string, email: string, now: string): BindResult {
  const inClass = rows.filter((r) => r.classId === classId);
  const bySub = inClass.find((r) => r.googleSub && r.googleSub === sub);
  if (bySub) {
    if (bySub.status !== 'active') return { ok: false, reason: 'withdrawn' };
    return { ok: true, row: bySub, newlyBound: false, emailChanged: bySub.email !== email.toLowerCase() };
  }
  const byEmail = inClass.find((r) => r.email === email.toLowerCase());
  if (!byEmail) return { ok: false, reason: 'not-enrolled' };
  if (byEmail.googleSub && byEmail.googleSub !== sub) return { ok: false, reason: 'bound-to-other-account' };
  if (byEmail.status !== 'active') return { ok: false, reason: 'withdrawn' };
  return { ok: true, row: { ...byEmail, googleSub: sub, boundAt: now }, newlyBound: true, emailChanged: false };
}
