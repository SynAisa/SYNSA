// Synthesized alert chimes via the Web Audio API — no sound files needed.
// Swap this module out later for real files by changing `play()` to load
// and trigger an <audio> element per alert type; the call sites in
// overlay.js (AlertSounds.play(type, data)) stay the same.
window.AlertSounds = (function () {
  let ctx = null;
  let masterGain = null;
  let volume = 0.6;

  // Gentle, warm chimes — short sine/triangle notes with a soft attack and
  // exponential decay, low-passed slightly so nothing reads as harsh or
  // "gamer HUD". Frequencies are simple major intervals for a calm,
  // pleasant feel.
  const CHIMES = {
    follow: [
      { freq: 987.77, t: 0, dur: 0.35, type: 'sine', peak: 0.32 }, // B5
      { freq: 1318.5, t: 0.09, dur: 0.45, type: 'sine', peak: 0.28 }, // E6
    ],
    subscription: [
      { freq: 523.25, t: 0, dur: 0.4, type: 'triangle', peak: 0.26 }, // C5
      { freq: 659.25, t: 0.08, dur: 0.4, type: 'triangle', peak: 0.26 }, // E5
      { freq: 783.99, t: 0.16, dur: 0.55, type: 'triangle', peak: 0.28 }, // G5
    ],
    subscriptionGift: [
      { freq: 523.25, t: 0, dur: 0.28, type: 'triangle', peak: 0.22 }, // C5
      { freq: 659.25, t: 0.07, dur: 0.28, type: 'triangle', peak: 0.22 }, // E5
      { freq: 783.99, t: 0.14, dur: 0.28, type: 'triangle', peak: 0.24 }, // G5
      { freq: 1046.5, t: 0.21, dur: 0.5, type: 'sine', peak: 0.28 }, // C6 sparkle
    ],
    cheer: [
      { freq: 659.25, t: 0, dur: 0.22, type: 'sine', peak: 0.26 }, // E5
      { freq: 830.61, t: 0.05, dur: 0.22, type: 'sine', peak: 0.26 }, // G#5
      { freq: 1046.5, t: 0.1, dur: 0.4, type: 'sine', peak: 0.3 }, // C6
    ],
    raid: [
      { freq: 392.0, t: 0, dur: 0.5, type: 'triangle', peak: 0.26 }, // G4
      { freq: 523.25, t: 0.12, dur: 0.5, type: 'triangle', peak: 0.26 }, // C5
      { freq: 659.25, t: 0.24, dur: 0.65, type: 'sine', peak: 0.3 }, // E5
    ],
  };

  function ensureContext() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 6000;
      masterGain = ctx.createGain();
      masterGain.gain.value = volume;
      masterGain.connect(filter);
      filter.connect(ctx.destination);
    }
    return ctx;
  }

  function setVolume(v) {
    volume = Math.max(0, Math.min(1, v));
    if (masterGain) masterGain.gain.value = volume;
  }

  function playTone(freq, startTime, duration, opts) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = opts.type || 'sine';
    osc.frequency.value = freq;

    gain.gain.setValueAtTime(0, startTime);
    gain.gain.linearRampToValueAtTime(opts.peak, startTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

    osc.connect(gain);
    gain.connect(masterGain);

    osc.start(startTime);
    osc.stop(startTime + duration + 0.05);
  }

  function play(type, data) {
    const key = type === 'subscription' && data && data.isGift ? 'subscriptionGift' : type;
    const notes = CHIMES[key];
    if (!notes) return;

    ensureContext();
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }

    const now = ctx.currentTime + 0.01;
    notes.forEach((note) => {
      playTone(note.freq, now + note.t, note.dur, { type: note.type, peak: note.peak });
    });
  }

  // Browsers block audio without a prior user gesture. Call this from a
  // click handler (only relevant for local browser preview — OBS's
  // Browser Source allows autoplay without one).
  function unlock() {
    ensureContext();
    return ctx.state === 'suspended' ? ctx.resume() : Promise.resolve();
  }

  return { play, setVolume, unlock };
})();
