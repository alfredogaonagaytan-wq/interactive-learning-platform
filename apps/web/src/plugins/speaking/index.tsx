import { useEffect, useId, useState } from 'react';
import { randomId, SELF_RATINGS, transcriptMatches, type SpeakingItem, type SpeakingResponse, type SpeakingTarget, type SpeakingTargetResponse } from '@ilp/core';
import { Checkbox, FeedbackFields, NumberField, Select, SkillsField, TextField, TextArea } from '../../ui/fields';
import { RowControls, moveInArray } from '../../ui/lists';
import { AudioField } from '../../ui/audioField';
import { AudioPlayer } from '../../ui/audioPlayer';
import { useAssetUrl } from '../../storage/assets';
import { deleteRecording, listRecordings, putRecording, type StoredRecording } from '../../storage/db';
import { RECORDER_MESSAGES, useRecorder } from '../../ui/recorder';
import { onDeviceRecognition, recognizeOnce, speak, speechRecognitionCtor, ttsSupported } from '../../ui/speech';
import type { ItemPlugin, PlayerContext } from '../types';
import { blobBytes } from '../../app/util';

const EMPTY: SpeakingTargetResponse = { recordings: 0, selectedRecordingId: null, selfRating: null, heard: null };

export const speakingPlugin: ItemPlugin<SpeakingItem, SpeakingResponse> = {
  type: 'speaking',
  label: 'Speaking practice',
  description: 'Listen to a model, record yourself, compare and self-assess. No automatic pronunciation score.',
  Editor({ item, onChange }) {
    const setT = (i: number, patch: Partial<SpeakingTarget>) => onChange({ ...item, targets: item.targets.map((t, k) => (k === i ? { ...t, ...patch } : t)) });
    return (
      <>
        <TextArea label="Instructions" rows={2} value={item.prompt} onChange={(prompt) => onChange({ ...item, prompt })} />
        <TextField label="Language and variety" hint="Used for the device voice and speech-to-text, e.g. en-US, en-GB, en-AU, ko-KR, es-MX." value={item.language} onChange={(language) => onChange({ ...item, language: language.trim() || 'en-US' })} />
        <fieldset>
          <legend>Words, phrases or sentences to say</legend>
          {item.targets.map((t, i) => (
            <div key={t.id} className="speak-target-edit">
              <div className="row">
                <input type="text" aria-label={`Phrase ${i + 1}`} placeholder="thirty-three thousand" value={t.text} onChange={(e) => setT(i, { text: e.target.value })} />
                <RowControls index={i} count={item.targets.length} label={`phrase ${i + 1}`} minCount={1} onMove={(a, b) => onChange({ ...item, targets: moveInArray(item.targets, a, b) })} onRemove={() => onChange({ ...item, targets: item.targets.filter((_, k) => k !== i) })} />
              </div>
              <input type="text" aria-label={`Phrase ${i + 1} focus`} placeholder="Focus (optional): /θ/ sound, stress on the 2nd syllable…" value={t.focus} onChange={(e) => setT(i, { focus: e.target.value })} />
              <details className="pair-image" open={!!t.modelAudio}>
                <summary>{t.modelAudio ? 'Model recording' : 'Add a model recording'}</summary>
                <AudioField label={`Phrase ${i + 1} model`} transcript={false} maxSeconds={60} value={t.modelAudio} onChange={(modelAudio) => setT(i, { modelAudio })} />
              </details>
            </div>
          ))}
          <button type="button" className="secondary" disabled={item.targets.length >= 30} onClick={() => onChange({ ...item, targets: [...item.targets, { id: randomId('seq'), text: '', focus: '', modelAudio: null }] })}>+ Add phrase</button>
        </fieldset>
        <Checkbox label="Use the device voice when there is no model recording" hint="Voices and accents depend on the student’s device." checked={item.ttsFallback} onChange={(ttsFallback) => onChange({ ...item, ttsFallback })} />
        <Checkbox label="Students can hear the model before recording" checked={item.modelBeforeRecording} onChange={(modelBeforeRecording) => onChange({ ...item, modelBeforeRecording })} />
        <div className="grid-2">
          <NumberField label="Recordings per phrase" value={item.maxRecordings} min={1} max={20} nullable onChange={(maxRecordings) => onChange({ ...item, maxRecordings })} />
          <NumberField label="Maximum length (seconds)" value={item.maxSeconds} min={3} max={300} onChange={(v) => onChange({ ...item, maxSeconds: v ?? 30 })} />
        </div>
        <Select label="Recording submission" value={item.submission} onChange={(submission) => onChange({ ...item, submission })} options={[
          { value: 'none', label: 'Practice only — recordings stay on the student’s device' },
          { value: 'optional', label: 'Students may choose a recording to submit' },
          { value: 'required', label: 'Students must choose a recording for each phrase' },
        ]} hint="Sending recordings to your Google Drive arrives in Phase 5. Until then, chosen recordings stay on the student’s device." />
        <Checkbox label="Ask students to rate themselves" checked={item.selfAssessment} onChange={(selfAssessment) => onChange({ ...item, selfAssessment })} />
        <Checkbox
          label="Allow browser speech-to-text (opt-in)"
          hint="Shows students what the browser’s recogniser heard. Some browsers send the audio to Google or Apple to do this — enable only if your school allows it. It is not a pronunciation score, and accents that differ from the recogniser’s training can be misheard even when perfectly intelligible."
          checked={item.speechToText}
          onChange={(speechToText) => onChange({ ...item, speechToText })}
        />
        <Select label="Points" value={item.scoring} onChange={(scoring) => onChange({ ...item, scoring })} options={[
          { value: 'completion', label: 'For completing the practice' },
          { value: 'teacher-review', label: 'I will listen and score (teacher review)' },
          { value: 'none', label: 'No points' },
        ]} />
        {item.scoring !== 'none' && <NumberField label="Points available" value={item.points} min={0} max={1000} step={0.5} onChange={(v) => onChange({ ...item, points: v ?? 0 })} />}
        <SkillsField value={item.skills} onChange={(skills) => onChange({ ...item, skills })} />
        <FeedbackFields value={item.feedback} hint={false} onChange={(feedback) => onChange({ ...item, feedback })} />
      </>
    );
  },
  Player({ item, response, onChange, disabled, label, ctx }) {
    const [canOnDevice, setCanOnDevice] = useState(false);
    const asr = item.speechToText && !!speechRecognitionCtor();
    useEffect(() => {
      if (asr) void onDeviceRecognition(item.language).then(setCanOnDevice);
    }, [asr, item.language]);
    const setTarget = (id: string, patch: Partial<SpeakingTargetResponse>) =>
      onChange({ targets: { ...response.targets, [id]: { ...EMPTY, ...response.targets[id], ...patch } } });
    return (
      <div className="speaking" role="group" aria-label={`${label}: speaking practice`}>
        <p className="prompt preserve-lines">{item.prompt}</p>
        <p className="meta capability-note">
          Your recordings stay on this device{item.submission !== 'none' ? ' until they are sent to your teacher' : ''}. There is no automatic pronunciation score: listen, compare with the model, and rate yourself.
        </p>
        <ol className="speak-targets">
          {item.targets.map((t) => (
            <SpeakTarget key={t.id} item={item} target={t} state={{ ...EMPTY, ...response.targets[t.id] }} disabled={disabled} ctx={ctx} asr={asr} onDevice={canOnDevice} onPatch={(p) => setTarget(t.id, p)} />
          ))}
        </ol>
      </div>
    );
  },
};

function SpeakTarget({ item, target, state, disabled, ctx, asr, onDevice, onPatch }: {
  item: SpeakingItem;
  target: SpeakingTarget;
  state: SpeakingTargetResponse;
  disabled: boolean;
  ctx: PlayerContext | undefined;
  asr: boolean;
  onDevice: boolean;
  onPatch: (p: Partial<SpeakingTargetResponse>) => void;
}) {
  const ratingName = useId();
  const [recs, setRecs] = useState<Array<StoredRecording & { url: string }>>([]);
  const [heardMsg, setHeardMsg] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const [asrConsent, setAsrConsent] = useState(false);
  const [heardModel, setHeardModel] = useState(!item.modelBeforeRecording || !(target.modelAudio || (item.ttsFallback && ttsSupported())));
  const { url: modelUrl } = useAssetUrl(target.modelAudio?.assetId);
  const attemptId = ctx?.attemptId ?? 'preview';
  const persist = ctx?.mode !== 'teacher-preview';
  const limitReached = item.maxRecordings !== null && state.recordings >= item.maxRecordings;

  const refresh = async () => {
    const rows = (await listRecordings(attemptId)).filter((r) => r.itemId === item.id && r.targetId === target.id);
    setRecs((old) => {
      old.forEach((o) => URL.revokeObjectURL(o.url));
      return rows.map((r) => ({ ...r, url: URL.createObjectURL(new Blob([r.bytes as Uint8Array<ArrayBuffer>], { type: r.mime })) }));
    });
  };
  useEffect(() => {
    void refresh();
    return () => setRecs((old) => (old.forEach((o) => URL.revokeObjectURL(o.url)), []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attemptId, item.id, target.id]);

  const save = async (blob: Blob, mime: string, durationMs: number) => {
    const rec: StoredRecording = { id: randomId('att'), attemptId, activityId: ctx?.activity.id ?? '', itemId: item.id, targetId: target.id, mime, bytes: await blobBytes(blob), durationMs, createdAt: new Date().toISOString() };
    if (persist) await putRecording(rec);
    else setRecs((r) => [...r, { ...rec, url: URL.createObjectURL(blob) }]);
    onPatch({ recordings: state.recordings + 1, ...(item.submission !== 'none' && !state.selectedRecordingId ? { selectedRecordingId: rec.id } : {}) });
    if (persist) await refresh();
  };
  const recorder = useRecorder(item.maxSeconds, (r) => void save(r.blob, r.mime, r.durationMs));

  const playModel = () => {
    setHeardModel(true);
    if (!target.modelAudio && item.ttsFallback) speak(target.text, item.language);
  };

  const runAsr = async () => {
    setListening(true);
    setHeardMsg(null);
    try {
      const r = await recognizeOnce(item.language, onDevice);
      const matched = transcriptMatches(target.text, r.transcript, item.language);
      onPatch({ heard: { transcript: r.transcript, matched, onDevice } });
    } catch (e) {
      setHeardMsg((e as Error).message);
    } finally {
      setListening(false);
    }
  };

  return (
    <li className="speak-target card">
      <p className="speak-text" lang={item.language}>{target.text}</p>
      {target.focus && <p className="meta">Focus: {target.focus}</p>}
      <div className="row wrap">
        {target.modelAudio ? (
          <AudioPlayer src={modelUrl} label={`Model for “${target.text}”`} maxPlays={null} playsUsed={0} onPlay={() => setHeardModel(true)} speeds={[0.75, 1]} compact />
        ) : item.ttsFallback && ttsSupported() ? (
          <button type="button" className="secondary" onClick={playModel}>Listen (device voice)</button>
        ) : null}
      </div>
      <div className="row wrap">
        {recorder.state === 'recording' ? (
          <button type="button" className="danger-btn" onClick={recorder.stop}>Stop ({Math.floor(recorder.elapsed)} / {item.maxSeconds} s)</button>
        ) : (
          <button type="button" className="primary" disabled={disabled || limitReached || recorder.state === 'requesting' || recorder.state === 'unsupported' || !heardModel} onClick={recorder.start}>
            {state.recordings > 0 ? 'Record again' : 'Record'}
          </button>
        )}
        {!heardModel && <span className="meta">Listen to the model first.</span>}
        {limitReached && <span className="meta">You have used all {item.maxRecordings} recordings.</span>}
        {(recorder.state === 'unsupported' || recorder.state === 'denied' || recorder.state === 'no-microphone') && !disabled && !limitReached && (
          <label className="button secondary">
            Upload a recording…
            <input type="file" accept="audio/*" hidden onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) await save(f, f.type || 'audio/mpeg', 0); }} />
          </label>
        )}
      </div>
      {recorder.state !== 'idle' && recorder.state !== 'recording' && <p className="notice info" role="status">{RECORDER_MESSAGES[recorder.state]}</p>}
      {recs.length > 0 && (
        <ul className="recordings">
          {recs.map((r, i) => (
            <li key={r.id} className={state.selectedRecordingId === r.id ? 'is-selected' : ''}>
              <span className="meta">Attempt {i + 1}</span>
              <audio controls src={r.url} preload="metadata" aria-label={`Your recording ${i + 1} of “${target.text}”`} />
              {item.submission !== 'none' && (
                <label className="check">
                  <input type="radio" name={`sel-${item.id}-${target.id}`} disabled={disabled} checked={state.selectedRecordingId === r.id} onChange={() => onPatch({ selectedRecordingId: r.id })} /> Submit this one
                </label>
              )}
              {!disabled && (
                <button type="button" className="ghost danger small" onClick={async () => {
                  if (persist) await deleteRecording(r.id);
                  if (state.selectedRecordingId === r.id) onPatch({ selectedRecordingId: null });
                  if (persist) await refresh();
                  else setRecs((x) => x.filter((y) => y.id !== r.id));
                }}>Delete</button>
              )}
            </li>
          ))}
        </ul>
      )}
      {item.selfAssessment && state.recordings > 0 && (
        <fieldset className="self-rating">
          <legend>How did it sound?</legend>
          {([1, 2, 3] as const).map((n) => (
            <label key={n} className="check">
              <input type="radio" name={ratingName} disabled={disabled} checked={state.selfRating === n} onChange={() => onPatch({ selfRating: n })} /> {SELF_RATINGS[n]}
            </label>
          ))}
        </fieldset>
      )}
      {asr && !disabled && (
        <div className="asr">
          {!asrConsent ? (
            <details>
              <summary>Check with speech-to-text (optional)</summary>
              <p className="field-hint">
                {onDevice ? 'On this device, speech-to-text runs locally.' : 'On this browser, your voice may be sent to the browser maker (for example Google or Apple) to turn it into text.'}{' '}
                The result shows what the computer heard. It is not a pronunciation score, and it can mishear accents that are perfectly clear to people.
              </p>
              <button type="button" className="secondary" onClick={() => setAsrConsent(true)}>I understand — turn it on</button>
            </details>
          ) : (
            <button type="button" className="secondary" disabled={listening} onClick={runAsr}>{listening ? 'Listening… say the phrase' : 'Say it for speech-to-text'}</button>
          )}
          {state.heard && (
            <p className={`heard ${state.heard.matched ? 'fb-correct' : 'fb-partial'}`} role="status">
              Speech-to-text heard: “{state.heard.transcript || '…'}”. {state.heard.matched ? 'That matches the words.' : 'That does not match the words exactly — listen to the model and try again, or ask your teacher.'}
            </p>
          )}
          {heardMsg && <p className="notice error" role="alert">{heardMsg}</p>}
        </div>
      )}
    </li>
  );
}
