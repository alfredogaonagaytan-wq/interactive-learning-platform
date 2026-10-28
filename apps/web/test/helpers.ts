import { publishActivity, type Activity, type PublishedVersion } from '@ilp/core';
import { sampleActivity } from '../src/teacher/sample';
import { putActivity, putVersion } from '../src/storage/db';

/** Fictional activity with fixed, readable ids for UI tests. */
export function testActivity(overrides: Partial<Activity['settings']> = {}): Activity {
  const a = sampleActivity();
  a.title = 'Test: past simple';
  a.settings = { ...a.settings, ...overrides };
  // Turn off shuffling so the order is predictable in tests.
  a.items = a.items.map((i) => (i.type === 'multiple-choice' ? { ...i, shuffleChoices: false } : i));
  return a;
}

export async function published(a: Activity = testActivity()): Promise<PublishedVersion> {
  const { version, draft } = await publishActivity(a);
  await putActivity(draft);
  await putVersion(version);
  return version;
}

/** A real 1×1 PNG for media tests. */
export const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));

/** A real, tiny WAV file (0.5 s of a 440 Hz tone, 8 kHz mono PCM16). */
export function wav(seconds = 0.5): Uint8Array {
  const rate = 8000;
  const n = Math.floor(rate * seconds);
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 8000), true);
  return new Uint8Array(buf);
}

/** jsdom has no media playback: simulate play/pause/ended events. */
export function mockMediaElements() {
  Object.defineProperty(HTMLMediaElement.prototype, 'play', { configurable: true, value(this: HTMLMediaElement) { this.dispatchEvent(new Event('play')); return Promise.resolve(); } });
  Object.defineProperty(HTMLMediaElement.prototype, 'pause', { configurable: true, value(this: HTMLMediaElement) { this.dispatchEvent(new Event('pause')); } });
}

/** Fake microphone + MediaRecorder that produces a small WebM-signature blob. */
export function mockRecorder(opts: { deny?: boolean } = {}) {
  const tracks = [{ stop: () => {} }];
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: async () => { if (opts.deny) throw Object.assign(new Error('denied'), { name: 'NotAllowedError' }); return { getTracks: () => tracks }; } },
  });
  class FakeRecorder {
    static isTypeSupported = (t: string) => t.startsWith('audio/webm');
    state = 'inactive';
    mimeType = 'audio/webm';
    ondataavailable: ((e: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    onerror: (() => void) | null = null;
    start() { this.state = 'recording'; }
    stop() {
      this.state = 'inactive';
      this.ondataavailable?.({ data: new Blob([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3])], { type: 'audio/webm' }) });
      this.onstop?.();
    }
  }
  (window as unknown as { MediaRecorder: unknown }).MediaRecorder = FakeRecorder;
}

export function unmockRecorder() {
  delete (window as unknown as { MediaRecorder?: unknown }).MediaRecorder;
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined });
}
