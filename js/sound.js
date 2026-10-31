// Sound feedback generated with WebAudio — no audio files, works offline.
let ctx = null;
let enabled = true;

function audio() {
  if (!enabled) return null;
  if (!ctx) {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

function tone({ freq, dur = 0.12, type = 'sine', gain = 0.08, delay = 0, sweep = 0 }) {
  const ac = audio();
  if (!ac) return;
  const t0 = ac.currentTime + delay;
  const osc = ac.createOscillator();
  const amp = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (sweep) osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq + sweep), t0 + dur);
  amp.gain.setValueAtTime(0.0001, t0);
  amp.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
  amp.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(amp).connect(ac.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function noise({ dur = 0.09, gain = 0.06, delay = 0 }) {
  const ac = audio();
  if (!ac) return;
  const frames = Math.floor(ac.sampleRate * dur);
  const buf = ac.createBuffer(1, frames, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames) ** 2;
  const src = ac.createBufferSource();
  const amp = ac.createGain();
  amp.gain.value = gain;
  src.buffer = buf;
  src.connect(amp).connect(ac.destination);
  src.start(ac.currentTime + delay);
}

export const sound = {
  setEnabled(value) {
    enabled = !!value;
  },
  move() {
    tone({ freq: 320, dur: 0.06, type: 'triangle', gain: 0.05, sweep: -80 });
  },
  capture() {
    noise({ dur: 0.1, gain: 0.05 });
    tone({ freq: 160, dur: 0.09, type: 'triangle', gain: 0.05 });
  },
  opponent() {
    tone({ freq: 260, dur: 0.07, type: 'sine', gain: 0.04 });
  },
  correct() {
    tone({ freq: 660, dur: 0.1, type: 'sine', gain: 0.06 });
    tone({ freq: 880, dur: 0.12, type: 'sine', gain: 0.05, delay: 0.07 });
  },
  error() {
    tone({ freq: 180, dur: 0.14, type: 'sawtooth', gain: 0.05, sweep: -60 });
    tone({ freq: 140, dur: 0.16, type: 'sawtooth', gain: 0.04, delay: 0.1 });
  },
  success() {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
      tone({ freq: f, dur: 0.16, type: 'sine', gain: 0.055, delay: i * 0.075 })
    );
  },
  cycleComplete() {
    [392, 523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
      tone({ freq: f, dur: 0.28, type: 'triangle', gain: 0.055, delay: i * 0.11 })
    );
  },
};
