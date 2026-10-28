// Host sound: everything is synthesised with WebAudio (no audio files, nothing to license).
//  - music loop that speeds up and gets busier with `intensity` (0..1)
//  - drum roll that builds up, cymbal crash, little sound effects
// Browsers only allow audio after a click, so the first pointerdown unlocks it.
const Sound = (() => {
  let ac = null, sfxBus = null, musBus = null, noiseBuf = null, drumBus = null;
  let muted = false;
  try { muted = localStorage.getItem('quiz-mute') === '1'; } catch (e) {}
  let wanted = false, running = false, intensity = .2, step = 0, nextT = 0, timer = null;

  // Am - F - C - G, one bar each
  const ROOTS = [110, 87.31, 130.81, 98];
  const CHORDS = [[220, 261.63, 329.63, 440], [174.61, 220, 261.63, 349.23], [261.63, 329.63, 392, 523.25], [196, 246.94, 293.66, 392]];
  const ARP = [0, 1, 2, 3, 2, 1, 3, 2];

  function ctx() {
    if (!ac) {
      ac = new (window.AudioContext || window.webkitAudioContext)();
      sfxBus = ac.createGain(); sfxBus.gain.value = .9; sfxBus.connect(ac.destination);
      musBus = ac.createGain(); musBus.gain.value = 0; musBus.connect(ac.destination);
      noiseBuf = ac.createBuffer(1, ac.sampleRate >> 1, ac.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ac.state === 'suspended') ac.resume();
    return ac;
  }

  // one oscillator note at absolute time t
  function note(f, dur, type, vol, t, bus, slideTo) {
    const a = ctx(), o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.001, t + dur);
    o.connect(g).connect(bus || sfxBus); o.start(t); o.stop(t + dur + .03);
  }
  // a burst of filtered noise (hat / snare / crash)
  function burst(dur, vol, t, hp, bus) {
    const a = ctx(), s = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
    s.buffer = noiseBuf; f.type = 'highpass'; f.frequency.value = hp;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.001, t + dur);
    s.connect(f).connect(g).connect(bus || sfxBus); s.start(t); s.stop(t + dur + .03);
  }
  const now = (at = 0) => ctx().currentTime + at;
  const safe = fn => (...args) => { if (muted) return; try { return fn(...args); } catch (e) {} };

  // ---------- music ----------
  function scheduleStep() {
    const bar = (step >> 4) % 4, s = step & 15, t = nextT, I = intensity;
    const bpm = 108 + 46 * I, dur = 60 / bpm / 4;
    if (s % 4 === 0) note(150, .16, 'sine', .55, t, musBus, 45);                                  // kick
    if (I > .2 && s % 2 === 1) burst(.04, .05 + .05 * I, t, 7000, musBus);                         // hat
    if (I > .6 && s % 2 === 0) burst(.03, .04, t, 8000, musBus);
    if (I > .45 && (s === 4 || s === 12)) burst(.13, .16, t, 1500, musBus);                        // snare
    if (s % 2 === 0) note(s === 6 || s === 14 ? ROOTS[bar] * 2 : ROOTS[bar], dur * 1.8, 'square', .11, t, musBus);   // bass
    if (I > .12) note(CHORDS[bar][ARP[s & 7]] * (I > .7 && s >= 8 ? 2 : 1), dur * 1.5, 'triangle', .1, t, musBus);    // arpeggio
    if (I > .85 && s % 4 === 2) note(CHORDS[bar][3] * 2, dur, 'sawtooth', .035, t, musBus);        // tension
    nextT += dur; step++;
  }
  function pump() {
    if (!running) return;
    const a = ctx();
    if (nextT < a.currentTime) nextT = a.currentTime + .05;
    while (nextT < a.currentTime + .14) scheduleStep();
  }
  function begin() {
    if (running || muted || !wanted) return;
    try {
      const a = ctx(); running = true; step = 0; nextT = a.currentTime + .08;
      musBus.gain.cancelScheduledValues(a.currentTime); musBus.gain.setValueAtTime(musBus.gain.value, a.currentTime);
      musBus.gain.linearRampToValueAtTime(.34, a.currentTime + .5);
      clearInterval(timer); timer = setInterval(pump, 30);
    } catch (e) { running = false; }
  }
  function halt(fade = .4) {
    wanted = false;
    if (!running) return;
    running = false; clearInterval(timer);
    try { const a = ctx(); musBus.gain.cancelScheduledValues(a.currentTime); musBus.gain.setValueAtTime(musBus.gain.value, a.currentTime); musBus.gain.linearRampToValueAtTime(0, a.currentTime + fade); } catch (e) {}
  }

  // ---------- drum roll ----------
  function drumroll(sec) {
    if (muted) return;
    try {
      const a = ctx(); stopDrum();
      drumBus = a.createGain(); drumBus.connect(sfxBus);
      const t0 = a.currentTime + .03; let t = t0, k = 0;
      while (t < t0 + sec) {
        const p = (t - t0) / sec;                                   // 0 -> 1 crescendo
        burst(.1, .05 + .24 * p, t, 1600, drumBus);
        if (k % 3 === 0) note(120 - 40 * p, .14, 'sine', .1 + .16 * p, t, drumBus, 60);
        t += .14 - .1 * p; k++;
      }
    } catch (e) {}
  }
  function stopDrum() {
    if (!drumBus || !ac) return;
    try { drumBus.gain.cancelScheduledValues(ac.currentTime); drumBus.gain.setValueAtTime(0, ac.currentTime); } catch (e) {}
    drumBus = null;
  }

  const sfx = {
    tick: safe(() => note(660, .1, 'square', .05, now())),
    go: safe(() => { note(880, .12, 'triangle', .12, now()); note(1320, .25, 'triangle', .12, now(.1)); }),
    blip: safe(() => note(300 + Math.random() * 500, .05, 'square', .03, now())),
    pop: safe(() => note(520 + Math.random() * 300, .08, 'sine', .08, now())),
    fog: safe(() => { note(196, .6, 'sawtooth', .05, now()); note(147, .8, 'sine', .08, now(.1)); }),
    crash: safe(() => { stopDrum(); burst(1.4, .3, now(), 4500); note(110, .5, 'sine', .3, now(), null, 40); }),
    win: safe(() => [523, 659, 784, 1047, 1319].forEach((f, i) => note(f, .4, 'triangle', .13, now(i * .11))))
  };

  document.addEventListener('pointerdown', () => { try { ctx(); begin(); } catch (e) {} }, true);

  return {
    sfx, drumroll, stopDrum,
    isMuted: () => muted,
    setMuted(m) {
      muted = m; try { localStorage.setItem('quiz-mute', m ? '1' : '0'); } catch (e) {}
      if (m) { const w = wanted; halt(.15); wanted = w; stopDrum(); } else begin();
    },
    music(on, level) { if (level !== undefined) intensity = level; if (on) { wanted = true; begin(); } else halt(); },
    setIntensity(x) { intensity = Math.max(0, Math.min(1, x)); },
    stopMusic: halt,
    state: () => ({ music: running, wanted, muted, intensity })
  };
})();
