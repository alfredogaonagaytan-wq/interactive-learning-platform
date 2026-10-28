import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  attemptsRemaining, buildReport, canCheckItem, canRevealAnswers, canShowResults, getItemDefinition, gradeActivity, presentedItems, randomId, reportToCsv,
  selectItemIds, type Assignment, type Attempt, type Item, type ItemResult, type PublishedVersion,
} from '@ilp/core';
import { getPlugin } from '../plugins/registry';
import { deleteRecordingsExcept, getRecording, listAttempts, putAttempt } from '../storage/db';
import { enqueueSubmission, processOutbox } from '../google/outbox';
import { SubmissionStatus } from './SubmissionStatus';
import { getRetention } from '../storage/retention';
import { AudioPlayer } from '../ui/audioPlayer';
import { useAssetUrl } from '../storage/assets';
import type { PlayerContext } from '../plugins/types';
import { journalClear, journalRead, journalWrite } from '../storage/journal';
import { downloadText, formatTime, safeFilename } from '../app/util';
import { useConfirm } from '../ui/dialog';

export type PlayerMode = 'student' | 'preview' | 'teacher-preview';

interface Props {
  version: PublishedVersion;
  mode: PlayerMode;
  onExit?: () => void;
  /** Present when completing a teacher's assignment: submissions are delivered to the teacher's service. */
  assignment?: { brokerId: string; assignment: Assignment; studentNumber: string };
}

const SAVE_DELAY_MS = 300;

function newAttempt(v: PublishedVersion, mode: PlayerMode, attemptNumber: number, assignmentId: string | null = null): Attempt {
  const now = new Date().toISOString();
  const id = randomId('att');
  return {
    kind: 'ilp.attempt', schemaVersion: 1, id, activityId: v.activityId, version: v.version, contentHash: v.contentHash,
    mode: mode === 'student' ? 'student' : 'preview', assignmentId, attemptNumber, status: 'in-progress',
    // Question pools and shuffling are resolved once, when the attempt starts.
    presentedItemIds: selectItemIds(v.activity, id),
    responses: {}, checks: {}, hintsUsed: {}, mediaPlays: {}, startedAt: now, updatedAt: now, submittedAt: null, sync: 'local-only',
  };
}

export function ActivityPlayer({ version, mode, onExit, assignment }: Props) {
  const activity = version.activity;
  const settings = activity.settings;
  const persistent = mode !== 'teacher-preview';
  const confirm = useConfirm();

  const [loaded, setLoaded] = useState(false);
  const [history, setHistory] = useState<Attempt[]>([]);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [checked, setChecked] = useState<Record<string, ItemResult>>({});
  const [hintsShown, setHintsShown] = useState<Set<string>>(new Set());
  const [saveState, setSaveState] = useState<{ state: 'idle' | 'saving' | 'saved' | 'error'; at?: string; error?: string }>({ state: 'idle' });
  const [announce, setAnnounce] = useState('');

  const pending = useRef<Attempt | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const a = pending.current;
    if (!a || !persistent) return;
    pending.current = null;
    try {
      await putAttempt(a);
      journalClear(a);
      setSaveState({ state: 'saved', at: a.updatedAt });
    } catch (e) {
      pending.current = a; // keep it so the next change or flush retries
      setSaveState({ state: 'error', error: (e as Error).message });
    }
  }, [persistent]);

  const persist = useCallback(
    (a: Attempt, immediate = false) => {
      setAttempt(a);
      if (!persistent) return;
      pending.current = a;
      journalWrite(a); // synchronous safety net until IndexedDB confirms
      setSaveState((s) => ({ ...s, state: 'saving' }));
      if (timer.current) clearTimeout(timer.current);
      if (immediate) void flush();
      else timer.current = setTimeout(() => void flush(), SAVE_DELAY_MS);
    },
    [flush, persistent],
  );

  // Flush on tab hide / close so nothing typed is lost.
  useEffect(() => {
    const onHide = () => void flush();
    const onVis = () => document.visibilityState === 'hidden' && void flush();
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('pagehide', onHide);
      document.removeEventListener('visibilitychange', onVis);
      void flush();
    };
  }, [flush]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let past: Attempt[] = [];
      if (persistent) {
        past = await listAttempts(version.activityId, version.version, mode === 'student' ? 'student' : 'preview');
        // Student-preview of a draft: ignore attempts made against older draft content.
        if (mode === 'preview') past = past.filter((a) => a.contentHash === version.contentHash);
        // Recover changes that were journaled but not yet written to IndexedDB (tab closed mid-save).
        const j = journalRead({ activityId: version.activityId, version: version.version, mode: mode === 'student' ? 'student' : 'preview' });
        if (j && j.contentHash === version.contentHash) {
          const idx = past.findIndex((a) => a.id === j.id);
          if (idx === -1 || past[idx]!.updatedAt < j.updatedAt) {
            await putAttempt(j);
            if (idx === -1) past.push(j);
            else past[idx] = j;
          }
          journalClear(j);
        }
      }
      if (cancelled) return;
      const inProgress = past.find((a) => a.status === 'in-progress');
      const submitted = past.filter((a) => a.status === 'submitted');
      setHistory(submitted);
      if (inProgress) {
        setAttempt(inProgress);
        setSaveState({ state: 'saved', at: inProgress.updatedAt });
      } else if (submitted.length > 0) setAttempt(submitted.at(-1)!);
      else {
        const a = newAttempt(version, mode, 1, assignment?.assignment.id ?? null);
        setAttempt(a);
        if (persistent) await putAttempt(a);
      }
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [version, mode, persistent]);

  const items = useMemo(() => (attempt ? presentedItems(activity, attempt.presentedItemIds ?? null) : []), [activity, attempt?.presentedItemIds]);

  if (!loaded || !attempt) return <p role="status">Loading activity…</p>;

  const submitted = attempt.status === 'submitted';
  const attemptsUsed = history.length;
  const vis = { submitted, attemptsUsed, released: false };
  const showResults = mode === 'teacher-preview' ? submitted : canShowResults(settings, vis);
  const reveal = mode === 'teacher-preview' ? true : canRevealAnswers(settings, vis);
  const remaining = attemptsRemaining(settings, attemptsUsed);
  const result = submitted ? gradeActivity(activity, attempt.responses as never, attempt.presentedItemIds ?? null) : null;
  const resultById = new Map(result?.items.map((r) => [r.itemId, r]));
  const showKey = mode === 'teacher-preview';
  let qn = 0;

  const setResponse = (itemId: string, r: unknown) => {
    if (submitted) return;
    const { [itemId]: _drop, ...rest } = checked;
    setChecked(rest);
    persist({ ...attempt, responses: { ...attempt.responses, [itemId]: r }, updatedAt: new Date().toISOString() });
  };

  const check = (item: Item) => {
    const used = attempt.checks[item.id] ?? 0;
    if (mode !== 'teacher-preview' && !canCheckItem(settings, used)) return;
    const r = getItemDefinition(item.type).grade(item as never, attempt.responses[item.id] as never, { language: activity.language });
    setChecked((c) => ({ ...c, [item.id]: r }));
    setAnnounce(`${r.status === 'correct' ? 'Correct' : r.status === 'partial' ? 'Partly correct' : r.status === 'unanswered' ? 'Not answered yet' : 'Not correct yet'}. ${r.feedback ?? ''}`);
    persist({ ...attempt, checks: { ...attempt.checks, [item.id]: used + 1 }, updatedAt: new Date().toISOString() }, true);
  };

  const showHint = (item: Item) => {
    setHintsShown((s) => new Set(s).add(item.id));
    persist({ ...attempt, hintsUsed: { ...attempt.hintsUsed, [item.id]: (attempt.hintsUsed[item.id] ?? 0) + 1 }, updatedAt: new Date().toISOString() }, true);
  };

  const submit = async () => {
    const unanswered = items.filter((i) => {
      const d = getItemDefinition(i.type);
      return d.scorable && !d.isAnswered(i as never, attempt.responses[i.id] as never);
    }).length;
    const ok = await confirm({
      title: 'Submit your work?',
      body: unanswered > 0 ? `You have ${unanswered} unanswered question${unanswered === 1 ? '' : 's'}. You can't change answers after submitting.` : "You can't change your answers after submitting.",
      confirmLabel: 'Submit',
    });
    if (!ok) return;
    const now = new Date().toISOString();
    const done: Attempt = { ...attempt, status: 'submitted', submittedAt: now, updatedAt: now };
    persist(done, true);
    await flush();
    if (persistent && (await getRetention()).deleteUnselectedOnSubmit) {
      // Keep only recordings the student chose to submit; practice takes are deleted.
      const keep = new Set<string>();
      for (const it of items) {
        if (it.type !== 'speaking') continue;
        const r = done.responses[it.id] as { targets?: Record<string, { selectedRecordingId: string | null }> } | undefined;
        for (const t of Object.values(r?.targets ?? {})) if (t.selectedRecordingId) keep.add(t.selectedRecordingId);
      }
      await deleteRecordingsExcept(done.id, keep);
    }
    setHistory((h) => [...h, done]);
    setChecked({});
    if (assignment && mode === 'student') {
      // Queue delivery to the teacher's service and the student's Drive; it survives reloads and retries offline.
      const recordings = [];
      for (const it of items) {
        if (it.type !== 'speaking' || it.submission === 'none') continue;
        const r = done.responses[it.id] as { targets?: Record<string, { selectedRecordingId: string | null }> } | undefined;
        for (const [targetId, t] of Object.entries(r?.targets ?? {})) {
          const rec = t.selectedRecordingId ? await getRecording(t.selectedRecordingId) : undefined;
          if (rec) recordings.push({ id: rec.id, itemId: it.id, targetId, mime: rec.mime, base64: toBase64(rec.bytes) });
        }
      }
      const local = gradeActivity(activity, done.responses as never, done.presentedItemIds ?? null);
      await enqueueSubmission({
        brokerId: assignment.brokerId, assignmentId: assignment.assignment.id, title: assignment.assignment.title,
        payload: { assignmentId: assignment.assignment.id, attemptId: done.id, attemptNumber: done.attemptNumber, startedAt: done.startedAt, submittedAt: done.submittedAt!, presentedItemIds: done.presentedItemIds ?? null, responses: done.responses, checks: done.checks, hintsUsed: done.hintsUsed, clientScore: assignment.assignment.grading === 'hidden' ? null : local.score, recordings },
        report: buildReport(activity, done, { revealAnswers: false, studentNumber: assignment.studentNumber, classId: assignment.assignment.classId }),
      });
      void processOutbox({ interactive: true });
    }
    setAnnounce('Submitted.');
    window.scrollTo({ top: 0 });
  };

  const tryAgain = () => {
    const a = newAttempt(version, mode, history.length + 1, assignment?.assignment.id ?? null);
    setChecked({});
    setHintsShown(new Set());
    persist(a, true);
  };

  const ctx: PlayerContext = {
    activity,
    attemptId: attempt.id,
    mode,
    submitted,
    reveal: submitted && showResults && reveal,
    plays: (key) => attempt.mediaPlays?.[key] ?? 0,
    countPlay: (key) => persist({ ...attempt, mediaPlays: { ...attempt.mediaPlays, [key]: (attempt.mediaPlays?.[key] ?? 0) + 1 }, updatedAt: new Date().toISOString() }, true),
  };
  const audioById = new Map(activity.items.filter((i) => i.type === 'audio').map((i) => [i.id, i]));

  const report = () => buildReport(activity, attempt, { revealAnswers: reveal });
  const base = `${safeFilename(activity.title)}-v${version.version}-attempt${attempt.attemptNumber}`;

  return (
    <article className={`player ${activity.items.some((i) => i.type === 'observation-notes') ? 'wide' : ''}`} aria-labelledby="activity-title">
      <header className="player-head">
        <div>
          <h1 id="activity-title">{activity.title}</h1>
          {activity.description && <p className="lede preserve-lines">{activity.description}</p>}
          <p className="meta">
            Version {version.version} · Attempt {attempt.attemptNumber}
            {settings.maxAttempts !== null && ` of ${settings.maxAttempts}`}
            {mode === 'preview' && <span className="badge warn">Student preview — not a real submission</span>}
            {mode === 'teacher-preview' && <span className="badge info">Teacher preview — answer key shown, nothing saved</span>}
          </p>
        </div>
        {persistent && <SaveIndicator state={saveState} />}
      </header>

      <div className="sr-only" aria-live="polite" role="status">{announce}</div>

      {submitted && (
        <section className="results-summary card" aria-labelledby="results-h">
          <h2 id="results-h">{showResults ? 'Your results' : 'Submitted'}</h2>
          {showResults && result ? (
            <>
              <p className="score">
                <strong>{result.score}</strong> / {result.maxScore} points{result.percent !== null && <> · {result.percent}%</>}
              </p>
              <p className="meta">
                {result.counts.correct} correct · {result.counts.partial} partly correct · {result.counts.incorrect} incorrect · {result.counts.unanswered} unanswered
              </p>
            </>
          ) : (
            <p>Your work was submitted on {formatTime(attempt.submittedAt!)}. Your teacher will release the results.</p>
          )}
          {mode === 'student' && !assignment && <p className="meta">Saved on this device only (this activity was not assigned through a teacher’s link).</p>}
          {assignment && mode === 'student' && <SubmissionStatus attemptId={attempt.id} />}
          <div className="actions">
            {showResults && (
              <>
                <button type="button" className="secondary" onClick={() => downloadText(`${base}-report.json`, JSON.stringify(report(), null, 2))}>Download report (JSON)</button>
                <button type="button" className="secondary" onClick={() => downloadText(`${base}-report.csv`, reportToCsv(report()), 'text/csv')}>Download report (CSV)</button>
                <button type="button" className="secondary" onClick={() => window.print()}>Print / save as PDF</button>
              </>
            )}
            {(remaining === null || remaining > 0) && <button type="button" onClick={tryAgain}>Try again{remaining !== null && ` (${remaining} left)`}</button>}
            {onExit && <button type="button" className="ghost" onClick={onExit}>Back</button>}
          </div>
        </section>
      )}

      <ol className="items">
        {items.map((item) => {
          const def = getItemDefinition(item.type);
          const plugin = getPlugin(item.type);
          const Player = plugin.Player;
          const qLabel = def.scorable ? `Question ${++qn}` : 'Information';
          const r = submitted ? (showResults ? resultById.get(item.id) : undefined) : checked[item.id];
          const used = attempt.checks[item.id] ?? 0;
          const hint = 'feedback' in item ? item.feedback.hint : undefined;
          const gapHints = 'segments' in item && item.segments.some((sg) => sg.kind === 'blank' && sg.hint);
          const hintsOpen = hintsShown.has(item.id);
          const canCheck = !submitted && def.scorable && (mode === 'teacher-preview' || canCheckItem(settings, used));
          const correctAnswers = submitted && showResults && reveal && def.scorable ? def.correctAnswers(item as never) : [];
          return (
            <li key={item.id} className={`item card ${def.scorable ? '' : 'item-content'} ${r ? `status-${r.status}` : ''}`}>
              {def.scorable && (
                <div className="item-head">
                  <span className="qnum">{qLabel}</span>
                  <span className="points">{def.maxScore(item as never)} pt{def.maxScore(item as never) === 1 ? '' : 's'}</span>
                </div>
              )}
              {'audioCue' in item && item.audioCue && audioById.get(item.audioCue.audioItemId) && (
                <CuePlayer cue={item.audioCue} audio={audioById.get(item.audioCue.audioItemId)!} ctx={ctx} label={qLabel} />
              )}
              <Player ctx={ctx} item={item} response={(attempt.responses[item.id] as never) ?? def.emptyResponse(item as never)} onChange={(v: unknown) => setResponse(item.id, v)} disabled={submitted} result={r} showKey={showKey} seed={attempt.id} label={qLabel} hintsShown={hintsOpen} />
              {r && r.status !== 'ungraded' && (
                <div className={`feedback fb-${r.status}`}>
                  <strong>{statusText(r.status)}</strong>
                  {submitted && <> — {r.score} / {r.maxScore}</>}
                  {r.feedback && <p>{r.feedback}</p>}
                  {submitted && 'feedback' in item && item.feedback.explanation && <p className="explanation">{item.feedback.explanation}</p>}
                </div>
              )}
              {correctAnswers.length > 0 && r?.status !== 'correct' && (
                <p className="correct-answers"><strong>Accepted answer{correctAnswers.length > 1 ? 's' : ''}:</strong> {correctAnswers.join('; ')}</p>
              )}
              {!submitted && def.scorable && (
                <div className="item-actions">
                  {canCheck && <button type="button" className="secondary" onClick={() => check(item)}>Check{settings.checksPerItem !== null && mode !== 'teacher-preview' ? ` (${settings.checksPerItem - used} left)` : ''}</button>}
                  {settings.showHints && (hint || gapHints) && (hintsOpen ? (hint ? <p className="hint" role="note"><strong>Hint:</strong> {hint}</p> : null) : <button type="button" className="ghost" onClick={() => showHint(item)}>Show hint</button>)}
                </div>
              )}
            </li>
          );
        })}
      </ol>

      {!submitted && (
        <div className="submit-bar">
          <button type="button" className="primary large" onClick={submit}>Submit</button>
        </div>
      )}
    </article>
  );
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function CuePlayer({ cue, audio, ctx, label }: { cue: NonNullable<Extract<Item, { type: 'multiple-choice' }>['audioCue']>; audio: Extract<Item, { type: 'audio' }>; ctx: PlayerContext; label: string }) {
  const { url } = useAssetUrl(audio.audio?.assetId);
  return (
    <div className="cue">
      <AudioPlayer
        src={audio.audio ? url : null}
        label={`${label} audio${audio.title ? `: ${audio.title}` : ''}`}
        maxPlays={ctx.mode === 'teacher-preview' ? null : audio.maxPlays}
        playsUsed={ctx.plays(audio.id)}
        onPlay={() => ctx.countPlay(audio.id)}
        speeds={audio.speeds}
        segment={{ start: cue.start, end: cue.end }}
        compact
      />
    </div>
  );
}

function statusText(s: ItemResult['status']): string {
  return { correct: 'Correct', partial: 'Partly correct', incorrect: 'Not correct', unanswered: 'Not answered', 'needs-review': 'Your teacher will review this', ungraded: '' }[s];
}

function SaveIndicator({ state }: { state: { state: string; at?: string; error?: string } }) {
  const online = useOnline();
  let text = 'Not saved yet';
  if (state.state === 'saving') text = 'Saving…';
  if (state.state === 'saved') text = `Saved on this device${state.at ? ` · ${new Date(state.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}`;
  if (state.state === 'error') text = `Could not save: ${state.error}. Keep this tab open.`;
  return (
    <div className={`save-indicator ${state.state}`} role="status" aria-live="polite">
      <span>
        <span className="dot" aria-hidden="true" />
        {text}
      </span>
      <span className="sync-note">{online ? 'Not synced (local only)' : 'Offline — work is kept on this device'}</span>
    </div>
  );
}

export function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}
