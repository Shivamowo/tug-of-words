// Tiny chiptune engine: synthesized SFX + step-sequenced music. No audio files.
const Audio8 = (() => {
  let ctx = null, master, sfxBus, musicBus;
  let sfxOn = load("tow_sfx", true), musicOn = load("tow_music", true);
  let track = null, step = 0, nextT = 0, timer = null, tempo = 120;
  let silentEl = null;
  const MUSIC_VOL = 0.34, SFX_VOL = 0.6;

  function load(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v === "1"; } catch { return d; } }
  function save(k, v) { try { localStorage.setItem(k, v ? "1" : "0"); } catch {} }

  function init() {
    if (ctx) { if (ctx.state === "suspended") ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try { ctx = new AC({ latencyHint: "interactive" }); } catch { ctx = new AC(); }
    // compressor = louder + consistent on tiny phone speakers
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20; comp.knee.value = 12; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.2;
    master = ctx.createGain(); master.gain.value = 0.9;
    master.connect(comp); comp.connect(ctx.destination);
    sfxBus = ctx.createGain(); sfxBus.gain.value = sfxOn ? SFX_VOL : 0; sfxBus.connect(master);
    musicBus = ctx.createGain(); musicBus.gain.value = musicOn ? MUSIC_VOL : 0; musicBus.connect(master);
    ctx.onstatechange = () => { if (ctx.state !== "running" && !document.hidden && silentEl) ctx.resume().catch(() => {}); };
    document.addEventListener("visibilitychange", () => {
      if (!ctx) return;
      if (document.hidden) ctx.suspend().catch(() => {});
      else { ctx.resume().catch(() => {}); if (track) nextT = ctx.currentTime + 0.05; }
    });
  }

  // Phones: must be called from inside a tap. iOS mutes Web Audio when the ring/silent
  // switch is on unless a media element is playing, so we loop a silent WAV + set the
  // audio session to "playback" where supported.
  function silentWavUrl() {
    const sr = 8000, n = sr / 2, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
    const w = (o, str) => [...str].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
    w(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); w(8, "WAVE"); w(12, "fmt ");
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    w(36, "data"); v.setUint32(40, n * 2, true);
    return URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
  }
  function unlock() {
    init();
    if (!ctx) return;
    try { if (navigator.audioSession) navigator.audioSession.type = "playback"; } catch {}
    if (!silentEl) {
      silentEl = document.createElement("audio");
      silentEl.setAttribute("playsinline", ""); silentEl.setAttribute("webkit-playsinline", "");
      silentEl.loop = true; silentEl.preload = "auto"; silentEl.src = silentWavUrl();
    }
    if (silentEl.paused) silentEl.play().catch(() => {});
    if (ctx.state !== "running") ctx.resume().catch(() => {});
    // prime with a 1-sample buffer (old iOS needs a sound started inside the gesture)
    try { const b = ctx.createBuffer(1, 1, 22050), s = ctx.createBufferSource(); s.buffer = b; s.connect(ctx.destination); s.start(0); } catch {}
  }
  const mtof = m => 440 * Math.pow(2, (m - 69) / 12);

  function tone(bus, f, t, dur, { type = "square", vol = 0.25, slide = 0, attack = 0.004 } = {}) {
    if (!ctx) return;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, f * slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(bus); o.start(t); o.stop(t + dur + 0.02);
  }
  let noiseBuf = null;
  function noise(bus, t, dur, { vol = 0.2, hp = 1000, lp = 12000 } = {}) {
    if (!ctx) return;
    if (!noiseBuf) {
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const s = ctx.createBufferSource(); s.buffer = noiseBuf;
    const h = ctx.createBiquadFilter(); h.type = "highpass"; h.frequency.value = hp;
    const l = ctx.createBiquadFilter(); l.type = "lowpass"; l.frequency.value = lp;
    const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(h); h.connect(l); l.connect(g); g.connect(bus); s.start(t); s.stop(t + dur);
  }
  const seq = (notes, gap, opts) => { const t = ctx.currentTime; notes.forEach((m, i) => m != null && tone(sfxBus, mtof(m), t + i * gap, gap * 1.6, opts)); };

  const SFX = {
    click: () => tone(sfxBus, 880, ctx.currentTime, 0.05, { vol: 0.15 }),
    type: () => tone(sfxBus, 1400 + Math.random() * 400, ctx.currentTime, 0.02, { vol: 0.04, type: "triangle" }),
    send: () => tone(sfxBus, 520, ctx.currentTime, 0.1, { vol: 0.18, slide: 2 }),
    recv: () => tone(sfxBus, 660, ctx.currentTime, 0.07, { vol: 0.1, type: "triangle" }),
    pull: () => { seq([72, 79], 0.06, { vol: 0.16 }); noise(sfxBus, ctx.currentTime, 0.15, { vol: 0.08, hp: 2500 }); },
    pullThem: () => seq([67, 64], 0.06, { vol: 0.12, type: "triangle" }),
    crit: () => { seq([72, 76, 79, 84, 88], 0.045, { vol: 0.2 }); noise(sfxBus, ctx.currentTime, 0.3, { vol: 0.12, hp: 4000 }); },
    whiff: () => tone(sfxBus, 400, ctx.currentTime, 0.35, { vol: 0.16, slide: 0.35, type: "triangle" }),
    spam: () => { tone(sfxBus, 110, ctx.currentTime, 0.25, { vol: 0.22, type: "sawtooth" }); tone(sfxBus, 116, ctx.currentTime, 0.25, { vol: 0.18, type: "sawtooth" }); },
    combo: () => seq([76, 80, 83, 88], 0.05, { vol: 0.17, type: "square" }),
    lol: () => seq([84, 81, 84, 81], 0.05, { vol: 0.12, type: "triangle" }),
    ruleOk: () => seq([79, 84], 0.07, { vol: 0.15 }),
    broke: () => seq([60, 56, 52], 0.09, { vol: 0.18, type: "sawtooth" }),
    fizzle: () => noise(sfxBus, ctx.currentTime, 0.35, { vol: 0.12, hp: 300, lp: 1500 }),
    flip: () => { const t = ctx.currentTime; tone(sfxBus, 300, t, 0.3, { vol: 0.15, slide: 4 }); seq([null, null, null, null, 84, 91], 0.05, { vol: 0.14 }); },
    event: () => { const t = ctx.currentTime; for (let i = 0; i < 4; i++) { tone(sfxBus, 880, t + i * 0.18, 0.09, { vol: 0.16 }); tone(sfxBus, 660, t + i * 0.18 + 0.09, 0.09, { vol: 0.16 }); } },
    count: () => tone(sfxBus, 660, ctx.currentTime, 0.12, { vol: 0.2 }),
    go: () => seq([72, 76, 79, 84], 0.06, { vol: 0.22 }),
    join: () => seq([76, 83], 0.08, { vol: 0.15, type: "triangle" }),
    emote: () => tone(sfxBus, 1000 + Math.random() * 600, ctx.currentTime, 0.06, { vol: 0.08, type: "triangle", slide: 1.5 }),
    tick: () => tone(sfxBus, 1200, ctx.currentTime, 0.03, { vol: 0.08 }),
    win: () => seq([72, 72, 72, 76, null, 74, 77, 79, null, 84, 84, 88], 0.09, { vol: 0.2 }),
    lose: () => seq([67, 66, 65, 64, null, null, 55], 0.18, { vol: 0.18, type: "triangle" }),
    error: () => tone(sfxBus, 180, ctx.currentTime, 0.18, { vol: 0.15, type: "square" })
  };

  // ---- music ----
  const CH = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]]; // Am F C G
  const TRACKS = {
    lobby: {
      bpm: 96, play(s, t, d) {
        const bar = Math.floor(s / 16) % 4, st = s % 16, c = CH[bar];
        if (st % 4 === 0) { tone(musicBus, mtof(c[0] - 12), t, d * 3, { type: "triangle", vol: 0.45 }); tone(musicBus, mtof(c[0]), t, d * 2, { type: "square", vol: 0.06 }); }
        if (st % 2 === 0) tone(musicBus, mtof(c[(st / 2) % 3] + 12), t, d * 1.5, { type: "square", vol: 0.12 });
        const mel = [76, null, 79, null, 81, null, 79, 76, null, 74, null, 72, 74, null, null, null];
        if (bar % 2 === 1 && mel[st]) tone(musicBus, mtof(mel[st]), t, d * 1.8, { type: "square", vol: 0.12 });
        if (st % 4 === 2) noise(musicBus, t, 0.03, { vol: 0.05, hp: 7000 });
      }
    },
    battle: {
      bpm: 150, play(s, t, d) {
        const bar = Math.floor(s / 16) % 4, st = s % 16, c = CH[bar];
        tone(musicBus, mtof(c[0] - 12 + (st % 2 ? 12 : 0)), t, d * 0.9, { type: "square", vol: 0.16 });
        tone(musicBus, mtof(c[st % 3] + 12 + (st % 6 >= 3 ? 12 : 0)), t, d * 0.8, { type: "square", vol: 0.1 });
        if (st % 4 === 0) tone(musicBus, 150, t, 0.12, { type: "sine", vol: 0.7, slide: 0.3 });
        if (st % 8 === 4) noise(musicBus, t, 0.12, { vol: 0.25, hp: 1500 });
        if (st % 2 === 1) noise(musicBus, t, 0.03, { vol: 0.08, hp: 8000 });
        const lead = [81, null, 79, 81, null, 84, null, 83, 81, null, 79, null, 76, null, 79, null];
        if (bar >= 2 && lead[st]) tone(musicBus, mtof(lead[st]), t, d * 1.5, { type: "square", vol: 0.13 });
      }
    }
  };

  function scheduler() {
    if (!ctx || !track) return;
    const d = 60 / tempo / 4;
    while (nextT < ctx.currentTime + 0.12) {
      TRACKS[track].play(step, nextT, d);
      nextT += d; step++;
    }
  }
  function play(name, bpmOverride) {
    if (!ctx) return;
    if (ctx.state !== "running") ctx.resume().catch(() => {});
    if (track === name && !bpmOverride) return;
    track = name; tempo = bpmOverride || TRACKS[name].bpm;
    if (!bpmOverride) step = 0;
    nextT = ctx.currentTime + 0.05;
    clearInterval(timer); timer = setInterval(scheduler, 25);
  }
  function stop() { track = null; clearInterval(timer); }

  return {
    init, unlock, play, stop,
    speedUp: bpm => { if (track) tempo = bpm; },
    sfx: name => { if (ctx && sfxOn && SFX[name]) try { SFX[name](); } catch {} },
    toggleSfx() { sfxOn = !sfxOn; save("tow_sfx", sfxOn); if (sfxBus) sfxBus.gain.value = sfxOn ? SFX_VOL : 0; return sfxOn; },
    toggleMusic() { musicOn = !musicOn; save("tow_music", musicOn); if (musicBus) musicBus.gain.value = musicOn ? MUSIC_VOL : 0; return musicOn; },
    get sfxOn() { return sfxOn; }, get musicOn() { return musicOn; }
  };
})();
window.Audio8 = Audio8;
