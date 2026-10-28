import type { Report } from '@ilp/core';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Readable report (uploaded to the student's Drive and converted to a Google Doc). Student number only, no name. */
export function reportToHtml(r: Report, receipt?: { receiptId: string; receivedAt: string; score: number | null; maxScore: number | null } | null): string {
  const status: Record<string, string> = { correct: 'Correct', partial: 'Partly correct', incorrect: 'Not correct', unanswered: 'Not answered', 'needs-review': 'Teacher review', ungraded: '' };
  const rows = r.items
    .map((i) => `<tr><td>${i.index}</td><td>${esc(i.prompt)}</td><td>${esc(i.response)}</td><td>${esc(status[i.status])}</td><td>${i.status === 'needs-review' ? '—' : `${i.score} / ${i.maxScore}`}</td></tr>`)
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(r.activityTitle)}</title></head><body>
<h1>${esc(r.activityTitle)}</h1>
<p><b>Student number:</b> ${esc(r.studentNumber ?? '—')} · <b>Assignment:</b> ${esc(r.assignmentId ?? '—')} · <b>Version:</b> ${r.activityVersion} · <b>Attempt:</b> ${r.attemptNumber}</p>
<p><b>Submitted:</b> ${esc(r.submittedAt ?? '')}${receipt ? ` · <b>Received by teacher:</b> ${esc(receipt.receivedAt)} (receipt ${esc(receipt.receiptId)})` : ''}</p>
<p><b>Score on this device:</b> ${r.totals.score} / ${r.totals.maxScore}${receipt && receipt.score !== null ? ` · <b>Verified score:</b> ${receipt.score} / ${receipt.maxScore}` : ''}${r.totals.needsReview ? ` · ${r.totals.needsReview} answer(s) waiting for teacher review` : ''}</p>
<h2>Answers</h2><table border="1" cellpadding="4"><tr><th>#</th><th>Question</th><th>Your answer</th><th>Result</th><th>Points</th></tr>${rows}</table>
${r.proficient.length ? `<h2>Strengths</h2><ul>${r.proficient.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>` : ''}
${r.needsPractice.length ? `<h2>Practise next</h2><ul>${r.needsPractice.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>` : ''}
${r.nextSteps.length ? `<h2>Next steps</h2><ul>${r.nextSteps.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>` : ''}
<p><i>Your copy, saved by Interactive Learning Platform. Your teacher’s copy is stored separately in your teacher’s Drive.</i></p>
</body></html>`;
}
