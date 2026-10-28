/**
 * Feature detection and thin wrappers for the browser's speech APIs.
 *
 * Speech recognition (Web Speech API) may send audio to the browser vendor
 * (Chrome: Google servers; Safari: Apple). Recent Chrome versions can run some
 * languages on the device; we detect that and say which one applies.
 * Text-to-speech uses the device's voices; quality and accents vary by device.
 */
type SR = {
  new (): SpeechRecognitionLike;
  available?: (o: { langs: string[]; processLocally: boolean }) => Promise<string>;
};
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  processLocally?: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string; confidence: number }>> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

export function speechRecognitionCtor(): SR | null {
  const w = window as unknown as { SpeechRecognition?: SR; webkitSpeechRecognition?: SR };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** true when the browser reports it can recognise `lang` entirely on this device. */
export async function onDeviceRecognition(lang: string): Promise<boolean> {
  const C = speechRecognitionCtor();
  if (!C?.available) return false;
  try {
    return (await C.available({ langs: [lang], processLocally: true })) === 'available';
  } catch {
    return false;
  }
}

export class SpeechError extends Error {
  constructor(public code: string) {
    super(
      {
        'not-allowed': 'Microphone or speech recognition is blocked in this browser.',
        'no-speech': 'No speech was heard. Try again a little closer to the microphone.',
        network: 'Speech-to-text needs an internet connection on this browser.',
        'language-not-supported': 'This browser cannot recognise that language.',
        aborted: 'Stopped.',
      }[code] ?? 'Speech-to-text did not work this time.',
    );
  }
}

export function recognizeOnce(lang: string, onDevice: boolean): Promise<{ transcript: string; confidence: number }> {
  const C = speechRecognitionCtor();
  if (!C) return Promise.reject(new SpeechError('unsupported'));
  return new Promise((resolve, reject) => {
    const r = new C();
    r.lang = lang;
    r.interimResults = false;
    r.maxAlternatives = 1;
    if (onDevice) r.processLocally = true;
    let settled = false;
    r.onresult = (e) => {
      const best = e.results[0]?.[0];
      settled = true;
      resolve({ transcript: best?.transcript ?? '', confidence: best?.confidence ?? 0 });
    };
    r.onerror = (e) => {
      settled = true;
      reject(new SpeechError(e.error));
    };
    r.onend = () => !settled && reject(new SpeechError('no-speech'));
    r.start();
  });
}

export function ttsSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof window.SpeechSynthesisUtterance === 'function';
}

export function speak(text: string, lang: string, rate = 1): void {
  if (!ttsSupported()) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang;
  u.rate = rate;
  const voices = speechSynthesis.getVoices();
  const exact = voices.find((v) => v.lang.toLowerCase() === lang.toLowerCase());
  const base = voices.find((v) => v.lang.toLowerCase().startsWith(lang.split('-')[0]!.toLowerCase()));
  if (exact ?? base) u.voice = (exact ?? base)!;
  speechSynthesis.speak(u);
}
