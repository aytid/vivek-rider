/* ===========================================================
   HIGHWAY KICK  -  a Road Rash style bike brawler
   Plain HTML + CSS + JS, no libraries.

   Files expected in /assets (you add these):
     assets/face.png   (or face.jpg)  your friend's face, square crop works best
     assets/horn.mp3   horn sound
     assets/kick.mp3   sound for every kick that lands (optional)
     assets/fall.mp3   sound when a rival falls after 3 kicks
   Missing files are skipped quietly, so the game still runs.
   =========================================================== */

(() => {
  "use strict";

  // ---------- Config ----------
  const CFG = {
    maxSpeed: 14, // world units per second at full speed
    accel: 5, // how fast you reach top speed
    steerSpeed: 1.7, // sideways units per second
    roadHalf: 1.3, // half road width in world units
    xLimit: 1.1, // how far the player can steer
    lanes: [-0.867, 0, 0.867],
    maxRivals: 5,
    kicksToDrop: 3,
    kickCooldown: 0.35, // seconds between kicks
    kickReachZ: 0.45, // how close front/back a rival must be
    kickReachXMin: 0.2, // rival must be beside, not on top of you
    kickReachXMax: 1.15,
    displayTopKmh: 180,
  };

  // ---------- Sound ----------
  // Every sound plays the file from /assets. Three layers keep it reliable:
  //   1. Web Audio buffer   (used when the game is served over http/https: instant, works on iPhone)
  //   2. <audio> element    (used when opened straight from a folder / file://)
  //   3. built-in synth     (only if a file is missing or the browser refuses it)
  // A sound that is triggered again restarts from the beginning instead of piling up.
  const SOUND_FILES = { horn: "assets/horn.mp3", kick: "assets/kick.mp3", fall: "assets/fall.mp3" };
  const SOUND_MAX_SECONDS = { horn: 0, kick: 0, fall: 0 }; // 0 = play the whole file; e.g. kick: 1.5 cuts it short
  const sfx = {};
  let actx = null;
  let noiseBuf = null;

  function getCtx() {
    if (actx) return actx;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) actx = new AC();
    } catch (e) { actx = null; }
    return actx;
  }

  function loadSound(name, file) {
    const s = (sfx[name] = { el: null, elFailed: false, buffer: null, voice: null, used: false });
    try {
      const a = new Audio();
      a.preload = "auto";
      a.addEventListener("error", () => { s.elFailed = true; });
      a.src = file;
      s.el = a;
    } catch (e) { s.elFailed = true; }
    // Decoding needs fetch(), which browsers only allow over http/https (not file://).
    if (location.protocol !== "file:" && window.fetch) {
      fetch(file)
        .then((r) => { if (!r.ok) throw new Error("missing"); return r.arrayBuffer(); })
        .then((data) => new Promise((res, rej) => {
          const c = getCtx();
          if (!c) return rej(new Error("no audio context"));
          c.decodeAudioData(data, res, rej);
        }))
        .then((buf) => { s.buffer = buf; })
        .catch(() => { /* fall back to the <audio> element */ });
    }
  }
  Object.keys(SOUND_FILES).forEach((n) => loadSound(n, SOUND_FILES[n]));

  // Call from a real tap/click so mobile browsers allow sound afterwards.
  function unlockAudio() {
    const c = getCtx();
    if (c) {
      try {
        if (c.state === "suspended") c.resume();
        const src = c.createBufferSource();
        src.buffer = c.createBuffer(1, 1, 22050);
        src.connect(c.destination);
        src.start(0);
      } catch (e) { /* ignore */ }
    }
    Object.values(sfx).forEach((s) => {
      const a = s.el;
      if (!a || s.elFailed) return;
      s.used = false;
      a.muted = true;
      let p;
      try { p = a.play(); } catch (e) { a.muted = false; return; }
      if (p && p.then) {
        p.then(() => { if (!s.used) { a.pause(); a.currentTime = 0; } a.muted = false; })
          .catch(() => { a.muted = false; });
      } else { a.muted = false; }
    });
  }

  function stopVoice(s) {
    if (s.voice) { try { s.voice.stop(); } catch (e) { /* already stopped */ } s.voice = null; }
  }

  function play(name) {
    const s = sfx[name];
    if (!s) return;
    const maxSec = SOUND_MAX_SECONDS[name] || 0;

    if (s.buffer && actx) { // 1. Web Audio
      try {
        if (actx.state === "suspended") actx.resume();
        stopVoice(s);
        const src = actx.createBufferSource();
        src.buffer = s.buffer;
        src.connect(actx.destination);
        src.start();
        if (maxSec > 0) src.stop(actx.currentTime + maxSec);
        s.voice = src;
        return;
      } catch (e) { /* try next layer */ }
    }

    if (s.el && !s.elFailed) { // 2. <audio> element from the assets folder
      try {
        s.used = true;
        s.el.muted = false;
        s.el.currentTime = 0;
        const p = s.el.play();
        if (p && p.catch) p.catch(() => synth(name));
        if (maxSec > 0) {
          clearTimeout(s.cutTimer);
          s.cutTimer = setTimeout(() => { try { s.el.pause(); } catch (e) { /* ignore */ } }, maxSec * 1000);
        }
        return;
      } catch (e) { /* try next layer */ }
    }
    synth(name); // 3. built-in fallback
  }

  function tone(freq, endFreq, dur, type, gain, delay) {
    const c = getCtx();
    if (!c) return;
    try {
      if (c.state === "suspended") c.resume();
      const t = c.currentTime + (delay || 0);
      const o = c.createOscillator(), g = c.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t);
      o.frequency.exponentialRampToValueAtTime(Math.max(1, endFreq), t + dur);
      g.gain.setValueAtTime(gain, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g); g.connect(c.destination);
      o.start(t); o.stop(t + dur + 0.02);
    } catch (e) { /* ignore */ }
  }
  function noise(dur, gain, cutoff, delay) {
    const c = getCtx();
    if (!c) return;
    try {
      if (!noiseBuf) {
        noiseBuf = c.createBuffer(1, c.sampleRate, c.sampleRate);
        const d = noiseBuf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      }
      const t = c.currentTime + (delay || 0);
      const src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
      src.buffer = noiseBuf; f.type = "lowpass"; f.frequency.value = cutoff;
      g.gain.setValueAtTime(gain, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      src.connect(f); f.connect(g); g.connect(c.destination);
      src.start(t); src.stop(t + dur + 0.02);
    } catch (e) { /* ignore */ }
  }
  function synth(name) {
    if (name === "kick") { noise(0.12, 0.6, 1400); tone(170, 45, 0.2, "sine", 0.8); }
    else if (name === "horn") { [0, 0.3].forEach((d) => { tone(392, 392, 0.22, "square", 0.12, d); tone(494, 494, 0.22, "square", 0.1, d); }); }
    else if (name === "fall") { tone(320, 55, 0.6, "sawtooth", 0.22); noise(0.5, 0.5, 700, 0.05); }
  }

  // ---------- Friend's face ----------
  // Tries assets/face.png, then .jpg / .jpeg / .webp. A broken or placeholder file is skipped automatically.
  const FACE_FILES = ["assets/face.png", "assets/face.jpg", "assets/face.jpeg", "assets/face.webp"];
  const face = new Image();
  let faceReady = false;
  let faceObjectUrl = null;
  let faceTry = 0;
  const assetStatus = document.getElementById("assetStatus");
  face.onload = () => {
    if (face.naturalWidth > 1 && face.naturalHeight > 1) {
      faceReady = true;
      if (assetStatus) assetStatus.textContent = "Friend's face loaded ✓";
    } else {
      face.onerror();
    }
  };
  face.onerror = () => {
    faceReady = false;
    if (faceObjectUrl && face.src === faceObjectUrl) {
      if (assetStatus) assetStatus.textContent = "That photo could not be read. Try another image.";
      return;
    }
    faceTry++;
    if (faceTry < FACE_FILES.length) face.src = FACE_FILES[faceTry];
    else if (assetStatus) assetStatus.textContent = "No face photo found. Add one below, or put face.png in the assets folder.";
  };
  face.src = FACE_FILES[0];

  // Optional: pick a face photo / music file right in the game (start screen).
  const faceUpload = document.getElementById("faceUpload");
  if (faceUpload) faceUpload.addEventListener("change", (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (faceObjectUrl) URL.revokeObjectURL(faceObjectUrl);
    faceObjectUrl = URL.createObjectURL(file);
    faceReady = false;
    face.src = faceObjectUrl;
    if (assetStatus) assetStatus.textContent = "Loading face photo…";
  });

  let customMusic = null;
  let musicObjectUrl = null;
  const audioUpload = document.getElementById("audioUpload");
  if (audioUpload) audioUpload.addEventListener("change", (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (musicObjectUrl) URL.revokeObjectURL(musicObjectUrl);
    musicObjectUrl = URL.createObjectURL(file);
    if (customMusic) { customMusic.pause(); customMusic = null; }
    customMusic = new Audio(musicObjectUrl);
    customMusic.loop = true;
    customMusic.volume = 0.7;
    customMusic.preload = "auto";
    if (assetStatus) assetStatus.textContent = "Music loaded ✓ It plays when you press START";
  });

  // ---------- Canvas ----------
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  let W = 0, H = 0, horizon = 0, playerY = 0, camH = 0, ppu = 0;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.floor(W * dpr);
    canvas.height = Math.floor(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    horizon = H * 0.36;
    playerY = H * 0.70; // ground line of the player bike
    camH = playerY - horizon;
    ppu = Math.min(W * 0.40, 300); // pixels per world unit at the player
  }
  window.addEventListener("resize", resize);
  resize();

  // ---------- State ----------
  const player = {
    x: 0, speed: 0, lean: 0,
    kickT: 0, kickSide: 1, kickCd: 0,
    bumpT: 0, steer: 0, lastSide: 1,
  };
  let rivals = [];
  let travelled = 0;
  let kos = 0;
  let running = false;
  let spawnT = 0;
  let shake = 0;

  const RIVAL_COLOURS = [
    { jacket: "#2ecc40", helmet: "#1b7d27", bike: "#2b8cff" },
    { jacket: "#c0392b", helmet: "#222", bike: "#ff3b30" },
    { jacket: "#8e44ad", helmet: "#f1c40f", bike: "#9b59b6" },
    { jacket: "#222", helmet: "#d4c13a", bike: "#e74c3c" },
    { jacket: "#e67e22", helmet: "#fff", bike: "#34495e" },
    { jacket: "#1abc9c", helmet: "#c0392b", bike: "#f39c12" },
  ];

  function spawnRival(z) {
    const c = RIVAL_COLOURS[Math.floor(Math.random() * RIVAL_COLOURS.length)];
    const lane = CFG.lanes[Math.floor(Math.random() * 3)];
    rivals.push({
      x: lane, tx: lane, z,
      farRel: -(4 + Math.random() * 4), // how fast you close the gap
      nearRel: -(0.12 + Math.random() * 0.1), // lingers beside you
      rel: -6,
      colours: c,
      hits: 0,
      state: "ride",
      fallT: 0, fallDir: 1,
      flash: 0, wobble: 0,
      laneT: 1 + Math.random() * 2,
    });
  }

  function reset() {
    rivals = [];
    travelled = 0;
    kos = 0;
    player.x = 0; player.speed = 0;
    spawnRival(4);
    spawnRival(14);
    spawnT = 2;
  }

  // ---------- Projection ----------
  function camX() { return player.x * 0.55; }
  function project(x, z) {
    const s = 1 / (z + 1);
    return { x: W / 2 + (x - camX()) * ppu * s, y: horizon + camH * s, s };
  }

  // ---------- Input ----------
  const held = { left: false, right: false };

  function bindHold(id, key) {
    const el = document.getElementById(id);
    const down = (e) => { e.preventDefault(); held[key] = true; el.classList.add("pressed"); try { el.setPointerCapture(e.pointerId); } catch (_) { } };
    const up = (e) => { e.preventDefault(); held[key] = false; el.classList.remove("pressed"); };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("lostpointercapture", up);
    el.addEventListener("contextmenu", (e) => e.preventDefault());
  }
  bindHold("btnLeft", "left");
  bindHold("btnRight", "right");

  function bindTap(id, fn) {
    const el = document.getElementById(id);
    el.addEventListener("pointerdown", (e) => { e.preventDefault(); fn(); });
    el.addEventListener("contextmenu", (e) => e.preventDefault());
  }
  bindTap("btnHorn", horn);
  bindTap("btnKick", kick);

  window.addEventListener("keydown", (e) => {
    if (e.repeat && (e.code === "Space" || e.code === "KeyH")) return;
    if (e.code === "ArrowLeft" || e.code === "KeyA") held.left = true;
    if (e.code === "ArrowRight" || e.code === "KeyD") held.right = true;
    if (e.code === "Space" || e.code === "KeyK") { e.preventDefault(); kick(); }
    if (e.code === "KeyH") horn();
  });
  window.addEventListener("keyup", (e) => {
    if (e.code === "ArrowLeft" || e.code === "KeyA") held.left = false;
    if (e.code === "ArrowRight" || e.code === "KeyD") held.right = false;
  });

  window.addEventListener("blur", () => { held.left = false; held.right = false; });

  const overlay = document.getElementById("overlay");
  document.getElementById("btnStart").addEventListener("click", () => {
    unlockAudio(); // lets phones play the sounds from now on
    overlay.classList.add("hidden");
    reset();
    running = true;
    if (customMusic) {
      customMusic.currentTime = 0;
      customMusic.play().catch(() => {
        if (assetStatus) assetStatus.textContent = "Tap START again to enable audio";
      });
    }
  });

  // ---------- Actions ----------
  function horn() {
    if (!running) return;
    play("horn");
    // Riders ahead in your lane get out of the way
    rivals.forEach((r) => {
      if (r.state === "ride" && r.z > 0.5 && r.z < 8 && Math.abs(r.x - player.x) < 0.5) {
        const options = CFG.lanes.filter((l) => Math.abs(l - player.x) > 0.6);
        r.tx = options[Math.floor(Math.random() * options.length)];
        r.laneT = 2.5;
      }
    });
  }

  const toastEl = document.getElementById("toast");
  let toastTimer = null;
  function toast(text) {
    toastEl.textContent = text;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("show"), 900);
  }

  function kick() {
    if (!running || player.kickCd > 0) return;
    player.kickCd = CFG.kickCooldown;
    play("kick"); // the kick sound plays on every kick, hit or miss

    // Nearest rival riding beside you
    let target = null, best = Infinity;
    for (const r of rivals) {
      if (r.state !== "ride") continue;
      const dx = r.x - player.x;
      const adx = Math.abs(dx);
      if (Math.abs(r.z) < CFG.kickReachZ && adx > CFG.kickReachXMin && adx < CFG.kickReachXMax) {
        const d = Math.abs(r.z) + adx * 0.5;
        if (d < best) { best = d; target = r; }
      }
    }

    player.kickSide = target ? Math.sign(target.x - player.x) || 1 : player.lastSide;
    player.kickT = 0.28;

    if (!target) return;

    target.hits++;
    target.flash = 0.25;
    target.wobble = 0.5;
    target.x += player.kickSide * 0.12;
    target.tx = target.x;
    shake = 0.15;

    if (target.hits >= CFG.kicksToDrop) {
      target.state = "fallen";
      target.fallDir = player.kickSide;
      target.fallT = 0;
      kos++;
      play("fall");
      toast("KNOCKED DOWN!");
    } else {
      toast(`HIT ${target.hits} / ${CFG.kicksToDrop}`);
    }
  }

  // ---------- Update ----------
  function update(dt) {
    // Speed: auto throttle, briefly slowed after a crash
    const target = player.bumpT > 0 ? CFG.maxSpeed * 0.45 : CFG.maxSpeed;
    player.speed += (target - player.speed) * Math.min(1, CFG.accel * dt * 0.3);
    const sf = player.speed / CFG.maxSpeed;
    travelled += player.speed * dt;

    // Steering
    player.steer = (held.right ? 1 : 0) - (held.left ? 1 : 0);
    if (player.steer !== 0) player.lastSide = player.steer;
    player.x += player.steer * CFG.steerSpeed * dt * (0.4 + 0.6 * sf);
    player.x = Math.max(-CFG.xLimit, Math.min(CFG.xLimit, player.x));
    player.lean += (player.steer * 0.22 - player.lean) * Math.min(1, dt * 8);

    player.kickT = Math.max(0, player.kickT - dt);
    player.kickCd = Math.max(0, player.kickCd - dt);
    player.bumpT = Math.max(0, player.bumpT - dt);
    shake = Math.max(0, shake - dt);

    // Rivals
    for (const r of rivals) {
      r.flash = Math.max(0, r.flash - dt);
      r.wobble = Math.max(0, r.wobble - dt);

      if (r.state === "fallen") {
        r.fallT += dt;
        r.z -= player.speed * dt * 0.9; // bike stops, you ride away from it
        r.x += r.fallDir * dt * 0.9 * Math.max(0, 1 - r.fallT);
        continue;
      }

      // Close the gap fast when far, then ease off so they ride beside you for a few seconds
      let wantRel;
      if (r.z > 0.4) {
        const t = Math.min(1, (r.z - 0.4) / 5);
        wantRel = r.nearRel + (r.farRel - r.nearRel) * t;
      } else if (r.z > -0.45) {
        wantRel = r.nearRel;
      } else {
        wantRel = -2.5;
      }
      r.rel += (wantRel - r.rel) * Math.min(1, dt * 6);
      r.z += r.rel * dt * sf;

      // As soon as they get close, move alongside the player
      if (!r.closed && r.z < 1.8) { r.closed = true; r.laneT = 0; }

      // Lane choice
      r.laneT -= dt;
      if (r.laneT <= 0) {
        r.laneT = 1.5 + Math.random() * 2.5;
        if (Math.abs(r.z) < 2) {
          // Ride up beside the player so a fight can happen
          const side = Math.random() < 0.5 ? -1 : 1;
          let nx = player.x + side * (0.6 + Math.random() * 0.3);
          if (Math.abs(nx) > CFG.xLimit) nx = player.x - side * 0.75;
          r.tx = Math.max(-CFG.xLimit, Math.min(CFG.xLimit, nx));
        } else {
          r.tx = CFG.lanes[Math.floor(Math.random() * 3)];
        }
      }
      const dx = r.tx - r.x;
      r.x += Math.sign(dx) * Math.min(Math.abs(dx), 0.7 * dt);

      // Crash into the player
      if (Math.abs(r.z) < 0.16 && Math.abs(r.x - player.x) < 0.3 && player.bumpT <= 0) {
        player.bumpT = 0.9;
        shake = 0.3;
        const push = Math.sign(r.x - player.x) || 1;
        r.tx = Math.max(-CFG.xLimit, Math.min(CFG.xLimit, r.x + push * 0.6));
        toast("CRASH!");
      }
    }
    rivals = rivals.filter((r) => r.z > -0.85);

    // Spawning
    spawnT -= dt;
    if (spawnT <= 0 && rivals.length < CFG.maxRivals) {
      spawnRival(22 + Math.random() * 10);
      spawnT = 1.8 + Math.random() * 2.2;
    }

    // HUD
    document.getElementById("speed").textContent = Math.round(sf * CFG.displayTopKmh);
    document.getElementById("kos").textContent = kos;
    document.getElementById("dist").textContent = (travelled / 250).toFixed(1);
  }

  // ---------- Drawing ----------
  function drawSky() {
    const g = ctx.createLinearGradient(0, 0, 0, horizon);
    g.addColorStop(0, "#5b8fe0");
    g.addColorStop(1, "#b9d4ff");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, horizon + 1);

    // Distant hills, parallax with steering
    const off = -camX() * 40;
    ctx.fillStyle = "#7d8ea6";
    ctx.beginPath();
    ctx.moveTo(-50, horizon);
    for (let i = -1; i <= 12; i++) {
      const x = i * (W / 10) + off;
      const y = horizon - 25 - 22 * Math.sin(i * 1.7) - 12 * Math.cos(i * 0.9);
      ctx.lineTo(x, y);
    }
    ctx.lineTo(W + 50, horizon);
    ctx.fill();

    // Clouds
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    for (let i = 0; i < 4; i++) {
      const cx = ((i * 157 + off * 0.5) % (W + 160) + W + 160) % (W + 160) - 80;
      const cy = horizon * (0.25 + 0.15 * (i % 2));
      ctx.beginPath();
      ctx.ellipse(cx, cy, 40, 12, 0, 0, Math.PI * 2);
      ctx.ellipse(cx + 25, cy - 6, 24, 10, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawRoad() {
    const seg = 0.7;
    const cxShift = camX();
    for (let y = Math.floor(horizon) + 1; y < H; y += 2) {
      const s = (y - horizon) / camH;
      const z = 1 / s - 1;
      const wz = z + travelled;
      const stripe = Math.floor(wz / seg) % 2 === 0;
      const fog = Math.min(1, z / 40);

      const centre = W / 2 - cxShift * ppu * s;
      const half = CFG.roadHalf * ppu * s;
      const rumble = half * 0.07;

      // grass / pavement
      ctx.fillStyle = mix(stripe ? "#5c9a3a" : "#538c33", "#b9d4ff", fog * 0.6);
      ctx.fillRect(0, y, W, 2);
      // kerb
      ctx.fillStyle = mix(stripe ? "#bbbbbb" : "#9a9a9a", "#b9d4ff", fog * 0.6);
      ctx.fillRect(centre - half - rumble * 3, y, (half + rumble * 3) * 2, 2);
      // rumble strip
      ctx.fillStyle = stripe ? "#d33" : "#eee";
      ctx.fillRect(centre - half - rumble, y, (half + rumble) * 2, 2);
      // asphalt
      ctx.fillStyle = mix(stripe ? "#5a5868" : "#55535f", "#b9d4ff", fog * 0.5);
      ctx.fillRect(centre - half, y, half * 2, 2);

      // lane dashes
      if (stripe) {
        const lw = Math.max(1, half * 0.022);
        ctx.fillStyle = "#f2f2f2";
        ctx.fillRect(centre - half * 0.333 - lw / 2, y, lw, 2);
        ctx.fillRect(centre + half * 0.333 - lw / 2, y, lw, 2);
      }
      // yellow edge lines
      ctx.fillStyle = "#e8c336";
      const ew = Math.max(1, half * 0.015);
      ctx.fillRect(centre - half * 0.94, y, ew, 2);
      ctx.fillRect(centre + half * 0.94 - ew, y, ew, 2);
    }
  }

  // Colour mixing helper for fog
  const colCache = {};
  function hexToRgb(h) {
    if (colCache[h]) return colCache[h];
    const n = parseInt(h.slice(1), 16);
    return (colCache[h] = [(n >> 16) & 255, (n >> 8) & 255, n & 255]);
  }
  function mix(a, b, t) {
    const A = hexToRgb(a), B = hexToRgb(b);
    return `rgb(${(A[0] + (B[0] - A[0]) * t) | 0}, ${(A[1] + (B[1] - A[1]) * t) | 0}, ${(A[2] + (B[2] - A[2]) * t) | 0})`;
  }

  // Roadside scenery
  function sceneryItems() {
    const items = [];
    const treeGap = 3.5;
    let start = Math.ceil((travelled - 0.8) / treeGap) * treeGap;
    for (let wz = start; wz < travelled + 40; wz += treeGap) {
      const z = wz - travelled;
      const side = Math.round(wz / treeGap) % 2 === 0 ? -1 : 1;
      items.push({ z, draw: () => drawTree(side * 2.0, z) });
    }
    const bGap = 5;
    start = Math.ceil((travelled - 0.8) / bGap) * bGap;
    for (let wz = start; wz < travelled + 40; wz += bGap) {
      const z = wz - travelled;
      const k = Math.round(wz / bGap);
      items.push({ z: z + 0.01, draw: () => drawBuilding(-3.4, z, k) });
      items.push({ z: z + 0.02, draw: () => drawBuilding(3.4, z, k + 7) });
    }
    return items;
  }

  function drawTree(x, z) {
    if (z < -0.8) return;
    const p = project(x, z);
    const u = ppu * p.s;
    ctx.fillStyle = "#6b4a2b";
    ctx.fillRect(p.x - u * 0.04, p.y - u * 0.45, u * 0.08, u * 0.45);
    ctx.fillStyle = "#2f7d32";
    ctx.beginPath();
    ctx.arc(p.x, p.y - u * 0.62, u * 0.26, 0, Math.PI * 2);
    ctx.arc(p.x - u * 0.15, p.y - u * 0.5, u * 0.18, 0, Math.PI * 2);
    ctx.arc(p.x + u * 0.15, p.y - u * 0.52, u * 0.18, 0, Math.PI * 2);
    ctx.fill();
  }

  const B_COLOURS = ["#8a6d5a", "#6f7c8f", "#a8846a", "#5e6b7d", "#b49c7d", "#7b5c4f"];
  function drawBuilding(x, z, k) {
    if (z < -0.8) return;
    const p = project(x, z);
    const u = ppu * p.s;
    const w = u * 1.6;
    const h = u * (1.6 + (k * 37 % 5) * 0.35);
    const fog = Math.min(1, z / 40);
    ctx.fillStyle = mix(B_COLOURS[Math.abs(k) % B_COLOURS.length], "#b9d4ff", fog * 0.6);
    ctx.fillRect(p.x - w / 2, p.y - h, w, h);
    // windows
    ctx.fillStyle = mix("#2b3a55", "#b9d4ff", fog * 0.6);
    const cols = 4, rows = Math.max(2, Math.floor(h / (u * 0.35)));
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        ctx.fillRect(p.x - w / 2 + w * (0.1 + c * 0.22), p.y - h + h * (0.06 + r / rows * 0.9), w * 0.12, h / rows * 0.5);
      }
    }
  }

  // Bike + rider drawn in a 70px wide design space, scaled to distance
  function drawBike(sx, sy, s, o) {
    const u = (ppu * s * 0.55) / 70;
    if (u < 0.05) return;
    ctx.save();
    ctx.translate(sx, sy);
    ctx.scale(u, u);

    // shadow
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.beginPath();
    ctx.ellipse(0, 0, 30, 6, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.rotate(o.lean || 0);

    const lw = (w) => { ctx.lineWidth = w; ctx.lineCap = "round"; ctx.lineJoin = "round"; };

    // rear tyre
    ctx.fillStyle = "#111";
    roundRect(-11, -34, 22, 34, 7); ctx.fill();
    ctx.fillStyle = "#333";
    roundRect(-6, -30, 12, 26, 4); ctx.fill();

    // exhausts
    ctx.fillStyle = "#9aa";
    roundRect(-25, -32, 9, 16, 3); ctx.fill();
    roundRect(16, -32, 9, 16, 3); ctx.fill();

    // tail section
    ctx.fillStyle = o.flash > 0 ? "#fff" : o.bike;
    roundRect(-19, -50, 38, 18, 6); ctx.fill();
    ctx.fillStyle = "#ff2a2a";
    roundRect(-11, -45, 22, 6, 2); ctx.fill();

    // seat
    ctx.fillStyle = "#1b1b1b";
    roundRect(-15, -60, 30, 12, 5); ctx.fill();

    // legs
    ctx.strokeStyle = o.legs || "#26324a";
    lw(9);
    const kick = o.kick || 0; // 0..1
    const ks = o.kickSide || 1;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(side * 11, -62);
      if (kick > 0 && side === ks) {
        ctx.lineTo(side * (30 + 34 * kick), -58 + 4 * kick);
      } else {
        ctx.lineTo(side * 22, -44);
        ctx.lineTo(side * 24, -26);
      }
      ctx.stroke();
      // boot
      ctx.fillStyle = "#111";
      ctx.beginPath();
      if (kick > 0 && side === ks) ctx.arc(side * (32 + 36 * kick), -57 + 4 * kick, 6, 0, Math.PI * 2);
      else ctx.arc(side * 24, -24, 5.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // handlebar
    ctx.strokeStyle = "#777";
    lw(4);
    ctx.beginPath(); ctx.moveTo(-34, -74); ctx.lineTo(34, -74); ctx.stroke();

    // torso
    ctx.fillStyle = o.flash > 0 ? "#fff" : o.jacket;
    roundRect(-20, -106, 40, 48, 12); ctx.fill();
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    roundRect(-3, -104, 6, 44, 3); ctx.fill();

    // arms
    ctx.strokeStyle = o.flash > 0 ? "#fff" : o.jacket;
    lw(9);
    ctx.beginPath(); ctx.moveTo(-17, -98); ctx.lineTo(-30, -76); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(17, -98); ctx.lineTo(30, -76); ctx.stroke();
    ctx.fillStyle = "#222";
    ctx.beginPath(); ctx.arc(-31, -74, 5, 0, Math.PI * 2); ctx.arc(31, -74, 5, 0, Math.PI * 2); ctx.fill();

    // head
// Head: friend's photo fitted naturally to the rider
if (o.face && faceReady) {
  const headX = 0;
  const headY = -123;
  const radius = 16;

  ctx.save();

  // Circular crop
  ctx.beginPath();
  ctx.arc(headX, headY, radius, 0, Math.PI * 2);
  ctx.clip();

  // Crop photo to fill the head
  const iw = face.naturalWidth;
  const ih = face.naturalHeight;
  const scale = (radius * 2) / Math.min(iw, ih);

  ctx.drawImage(
    face,
    headX - (iw * scale) / 2,
    headY - (ih * scale) / 2,
    iw * scale,
    ih * scale
  );

  ctx.restore();

  // Thin border
  ctx.strokeStyle = "#e8e8e8";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(headX, headY, radius, 0, Math.PI * 2);
  ctx.stroke();
} else {
  // Default helmet for other riders
  ctx.fillStyle = o.helmet;
  ctx.beginPath();
  ctx.arc(0, -120, 17, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "rgba(255,255,255,0.25)";
  ctx.beginPath();
  ctx.arc(-6, -127, 5, 0, Math.PI * 2);
  ctx.fill();
}

    ctx.restore();
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawRival(r) {
    const p = project(r.x, r.z);
    let lean = Math.sign(r.tx - r.x) * 0.12;
    if (r.wobble > 0) lean += Math.sin(r.wobble * 40) * 0.15;
    if (r.state === "fallen") lean = r.fallDir * Math.min(1.45, r.fallT * 4);
    drawBike(p.x, p.y, p.s, {
      lean,
      bike: r.colours.bike,
      jacket: r.colours.jacket,
      helmet: r.colours.helmet,
      flash: r.flash,
    });
    // hit pips above rivals who have been kicked
    if (r.state === "ride" && r.hits > 0 && r.z < 3) {
      const u = ppu * p.s;
      for (let i = 0; i < CFG.kicksToDrop; i++) {
        ctx.fillStyle = i < r.hits ? "#ff3b30" : "rgba(255,255,255,0.6)";
        ctx.beginPath();
        ctx.arc(p.x + (i - 1) * u * 0.07, p.y - u * 0.95, u * 0.025, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  function drawPlayer() {
    const p = project(player.x, 0);
    const k = player.kickT > 0 ? Math.sin((1 - player.kickT / 0.28) * Math.PI) : 0;
    const blink = player.bumpT > 0 && Math.floor(player.bumpT * 12) % 2 === 0;
    if (blink) ctx.globalAlpha = 0.5;
    drawBike(p.x, p.y, p.s, {
      lean: player.lean,
      bike: "#ffcc00",
      jacket: "#d81b60",
      helmet: "#ffd84a",
      legs: "#1f3b70",
      face: true,
      kick: k,
      kickSide: player.kickSide,
    });
    ctx.globalAlpha = 1;
  }

  function render() {
    ctx.save();
    if (shake > 0) ctx.translate((Math.random() - 0.5) * 10 * shake * 4, (Math.random() - 0.5) * 6 * shake * 4);
    drawSky();
    drawRoad();

    const items = sceneryItems();
    rivals.forEach((r) => items.push({ z: r.z, draw: () => drawRival(r) }));
    items.push({ z: 0.0001, draw: drawPlayer });
    items.sort((a, b) => b.z - a.z);
    items.forEach((i) => i.draw());
    ctx.restore();
  }

  // ---------- Loop ----------
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (running) update(dt);
    render();
    requestAnimationFrame(frame);
  }
  reset();
  requestAnimationFrame(frame);
})();
