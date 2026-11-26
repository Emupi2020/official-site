let audio;
let noise;
let playing;

export async function prepareWinnerSound() {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;
  try {
    audio ||= new AudioContext();
    if (audio.state !== 'running') await audio.resume();
  } catch {
    // Sound is optional even when the browser blocks audio.
  }
}

export function playWinnerSound(sound) {
  if (sound === 'off' || audio?.state !== 'running') return;
  if (playing) playing.disconnect();
  const output = audio.createGain();
  const start = audio.currentTime + 0.015;
  output.gain.value = 0.25;
  output.connect(audio.destination);
  playing = output;

  function voice(source, time, duration, level, filterType, frequency) {
    const gain = audio.createGain();
    gain.gain.setValueAtTime(level, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + duration);
    if (filterType) {
      const filter = audio.createBiquadFilter();
      filter.type = filterType;
      filter.frequency.value = frequency;
      source.connect(filter).connect(gain);
    } else source.connect(gain);
    gain.connect(output);
    source.start(time);
    source.stop(time + duration);
  }

  function hit(offset, duration, level, filter, frequency) {
    if (!noise) {
      noise = audio.createBuffer(1, audio.sampleRate, audio.sampleRate);
      const samples = noise.getChannelData(0);
      for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
    }
    const source = audio.createBufferSource();
    source.buffer = noise;
    voice(source, start + offset, duration, level, filter, frequency);
  }

  function tone(offset, frequency, duration, level, type = 'sine') {
    const source = audio.createOscillator();
    source.type = type;
    source.frequency.value = frequency;
    voice(source, start + offset, duration, level);
  }

  if (sound === 'chime') {
    [659, 784, 1047].forEach((frequency, i) => tone(i * 0.08, frequency, 0.26, 0.26));
  } else {
    const snare = sound === 'roll' ? [0, 0.065, 0.125, 0.18, 0.23, 0.28] : [0, 0.10];
    snare.forEach((offset, i) => {
      hit(offset, 0.11, 0.18 + 0.24 * (i + 1) / snare.length, 'bandpass', 1850);
      tone(offset, 185, 0.065, 0.09, 'triangle');
    });
    hit(snare.at(-1) + 0.045, 0.45, 0.34, 'highpass', 5700);
  }

  setTimeout(() => {
    if (playing === output) {
      output.disconnect();
      playing = null;
    }
  }, 900);
}
