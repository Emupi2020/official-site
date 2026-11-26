let audio;
let samples;

// Acoustic samples: Virtuosity Drums (CC0), distributed by Keyboardia.
const sampleFiles = ['roulette-snare-soft.m4a', 'roulette-snare.m4a', 'roulette-cymbal.m4a'];

export async function prepareRouletteSound() {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;
  try {
    audio ||= new AudioContext();
    const resume = audio.state === 'running' ? Promise.resolve() : audio.resume();
    samples ||= Promise.all(sampleFiles.map(async file => {
      const response = await fetch(new URL(file, import.meta.url));
      if (!response.ok) throw new Error('Could not load roulette audio');
      return audio.decodeAudioData(await response.arrayBuffer());
    })).catch(() => {
      samples = undefined;
      return null;
    });
    const [, buffers] = await Promise.all([resume, samples]);
    return buffers;
  } catch {
    // The draw still works when audio is unavailable.
  }
}

function hit(buffer, at, level, duration = buffer.duration) {
  const source = audio.createBufferSource();
  const gain = audio.createGain();
  source.buffer = buffer;
  duration = Math.min(duration, buffer.duration);
  gain.gain.value = level;
  gain.gain.setValueAtTime(level, at + duration * 0.7);
  gain.gain.linearRampToValueAtTime(0, at + duration);
  source.connect(gain).connect(audio.destination);
  source.onended = () => { source.disconnect(); gain.disconnect(); };
  source.start(at);
  source.stop(at + duration);
  return source;
}

export function startDrumRoll(buffers, duration) {
  const start = audio.currentTime + 0.015;
  const end = duration / 1000;
  const sources = [];
  for (let t = 0, i = 0; t < end - 0.05; i++) {
    const progress = t / end;
    const accent = i % 4 === 3;
    sources.push(hit(buffers[Number(accent)], start + t, (0.10 + progress * 0.24) * (accent ? 1 : 0.7), 0.16));
    t += 0.095 - progress * 0.036 + (i % 2 === 0 ? 0.004 : -0.004);
  }
  return () => {
    for (const source of sources) source.stop();
  };
}

export function playWinnerSound(sound, buffers) {
  if (!audio || audio.state !== 'running' || !buffers || sound === 'off') return;
  const at = audio.currentTime + 0.015;
  const [, snare, crash] = buffers;
  if (sound === 'chime') {
    [659, 784, 1047].forEach((frequency, i) => {
      const tone = audio.createOscillator();
      const gain = audio.createGain();
      const start = at + i * 0.075;
      tone.frequency.value = frequency;
      gain.gain.setValueAtTime(0.045, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.28);
      tone.connect(gain).connect(audio.destination);
      tone.onended = () => { tone.disconnect(); gain.disconnect(); };
      tone.start(start);
      tone.stop(start + 0.28);
    });
    return;
  }
  if (sound === 'snare') hit(snare, at, 0.45);
  hit(crash, at, sound === 'crash' ? 0.42 : 0.34, 1.05);
}
