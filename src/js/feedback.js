// One haptic and one beep when a result opens (plan M9). The beep is a Web Audio oscillator:
// no audio file.

import { hapticNotification } from './native.js';

/** Haptic type and tone of each result variant. */
export const FEEDBACK = Object.freeze({
  '4a': { haptic: 'SUCCESS', frequency: 1320, durationMs: 180 }, // high tone
  '4b': { haptic: 'ERROR', frequency: 330, durationMs: 350 }, // low tone
  '4c': { haptic: 'WARNING', frequency: 660, durationMs: 220 }, // neutral tone
  '4d': { haptic: 'WARNING', frequency: 660, durationMs: 220 },
  '4e': { haptic: 'WARNING', frequency: 660, durationMs: 220 },
});

/** The feedback of a variant (`4a`…`4e`); the neutral one for anything else. */
export function feedbackFor(variant) {
  return FEEDBACK[variant] || FEEDBACK['4e'];
}

let audio = null;

function audioContext() {
  const Context = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
  if (!Context) return null;
  if (!audio) audio = new Context();
  return audio;
}

/** Plays a short sine tone. Never throws. */
export function beep(frequency, durationMs) {
  try {
    const context = audioContext();
    if (!context) return;
    if (context.state === 'suspended') context.resume().catch(() => {});
    const start = context.currentTime;
    const end = start + durationMs / 1000;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;
    // Short fade in and out: no click.
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.4, start + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(start);
    oscillator.stop(end + 0.02);
  } catch (error) {
    console.warn('feedback: beep failed', error);
  }
}

/** Haptic + beep of a result variant. */
export function play(variant) {
  const { haptic, frequency, durationMs } = feedbackFor(variant);
  hapticNotification(haptic);
  beep(frequency, durationMs);
}
