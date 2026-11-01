/* ===========================================================
   HIGHWAY KICK - Road Rash style bike brawler
   Plain HTML + CSS + JavaScript, no libraries.
   =========================================================== */

(() => {
  "use strict";

  const CFG = {
    maxSpeed: 14,
    accel: 5,
    steerSpeed: 1.7,
    roadHalf: 1.3,
    xLimit: 1.1,
    lanes: [-0.867, 0, 0.867],
    maxRivals: 5,
    kicksToDrop: 3,
    kickCooldown: 0.35,
    kickReachZ: 0.45,
    kickReachXMin: 0.2,
    kickReachXMax: 1.15,
    displayTopKmh: 180,
  };

  // ---------- Assets ----------
  const sounds = {};

  function loadSound(name, file) {
    const a = new Audio();
    a.preload = "auto";
    a.src = file;
    a.addEventListener("error", () => {
      sounds[name] = null;
    });
    sounds[name] = a;
  }

  loadSound("horn", "assets/horn.mp3");
  loadSound("kick", "assets/kick.mp3");
  loadSound("fall", "assets/fall.mp3");

  function play(name) {
    const base = sounds[name];
    if (!base) return;

    try {
      const c = base.cloneNode();
      c.play().catch(() => {});
    } catch (_) {}
  }

  // Friend's face loaded directly from assets
  const face = new Image();
  let faceReady = false;

  face.onload = () => {
    faceReady = true;
  };

  face.onerror = () => {
    if (!face.dataset.triedJpg) {
      face.dataset.triedJpg = "1";
      face.src = "assets/face.jpg";
    }
  };

  face.src = "assets/face.png";

  // ---------- Canvas ----------
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");

  let W = 0;
  let H = 0;
  let horizon = 0;
  let playerY = 0;
  let camH = 0;
  let ppu = 0;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    W = window.innerWidth;
    H = window.innerHeight;

    canvas.width = Math.floor(W * dpr);
    canvas.height = Math.floor(H * dpr);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    horizon = H * 0.36;
    playerY = H * 0.70;
    camH = playerY - horizon;
    ppu = Math.min(W * 0.40, 300);
  }

  window.addEventListener("resize", resize);
  resize();

  // ---------- State ----------
  const player = {
    x: 0,
    speed: 0,
    lean: 0,
    kickT: 0,
    kickSide: 1,
    kickCd: 0,
    bumpT: 0,
    steer: 0,
    lastSide: 1,
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
    const c = RIVAL_COLOURS[
      Math.floor(Math.random() * RIVAL_COLOURS.length)
    ];

    const lane = CFG.lanes[
      Math.floor(Math.random() * 3)
    ];

    rivals.push({
      x: lane,
      tx: lane,
      z,
      farRel: -(4 + Math.random() * 4),
      nearRel: -(0.12 + Math.random() * 0.1),
      rel: -6,
      colours: c,
      hits: 0,
      state: "ride",
      fallT: 0,
      fallDir: 1,
      flash: 0,
      wobble: 0,
      laneT: 1 + Math.random() * 2,
    });
  }

  function reset() {
    rivals = [];
    travelled = 0;
    kos = 0;

    player.x = 0;
    player.speed = 0;

    spawnRival(4);
    spawnRival(14);

    spawnT = 2;
  }

  // ---------- Projection ----------
  function camX() {
    return player.x * 0.55;
  }

  function project(x, z) {
    const s = 1 / (z + 1);

    return {
      x: W / 2 + (x - camX()) * ppu * s,
      y: horizon + camH * s,
      s,
    };
  }

  // ---------- Input ----------
  const held = {
    left: false,
    right: false,
  };

  function bindHold(id, key) {
    const el = document.getElementById(id);

    const down = (e) => {
      e.preventDefault();
      held[key] = true;
      el.classList.add("pressed");

      try {
        el.setPointerCapture(e.pointerId);
      } catch (_) {}
    };

    const up = (e) => {
      e.preventDefault();
      held[key] = false;
      el.classList.remove("pressed");
    };

    el.addEventListener("pointerdown", down);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("lostpointercapture", up);

    el.addEventListener("contextmenu", (e) => {
      e.preventDefault();
    });
  }

  bindHold("btnLeft", "left");
  bindHold("btnRight", "right");

  function bindTap(id, fn) {
    const el = document.getElementById(id);

    el.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      fn();
    });

    el.addEventListener("contextmenu", (e) => {
      e.preventDefault();
    });
  }

  bindTap("btnHorn", horn);
  bindTap("btnKick", kick);

  window.addEventListener("keydown", (e) => {
    if (
      e.repeat &&
      (e.code === "Space" || e.code === "KeyH")
    ) {
      return;
    }

    if (e.code === "ArrowLeft" || e.code === "KeyA") {
      held.left = true;
    }

    if (e.code === "ArrowRight" || e.code === "KeyD") {
      held.right = true;
    }

    if (e.code === "Space") {
      e.preventDefault();
      kick();
    }

    if (e.code === "KeyH") {
      horn();
    }
  });

  window.addEventListener("keyup", (e) => {
    if (e.code === "ArrowLeft" || e.code === "KeyA") {
      held.left = false;
    }

    if (e.code === "ArrowRight" || e.code === "KeyD") {
      held.right = false;
    }
  });

  const overlay = document.getElementById("overlay");

  document.getElementById("btnStart").addEventListener("click", () => {
    Object.values(sounds).forEach((a) => {
      if (!a) return;

      a.muted = true;

      a.play()
        .then(() => {
          a.pause();
          a.currentTime = 0;
          a.muted = false;
        })
        .catch(() => {
          a.muted = false;
        });
    });

    overlay.classList.add("hidden");
    reset();
    running = true;
  });

  // ---------- Actions ----------
  function horn() {
    if (!running) return;

    play("horn");

    rivals.forEach((r) => {
      if (
        r.state === "ride" &&
        r.z > 0.5 &&
        r.z < 8 &&
        Math.abs(r.x - player.x) < 0.5
      ) {
        const options = CFG.lanes.filter(
          (l) => Math.abs(l - player.x) > 0.6
        );

        r.tx = options[
          Math.floor(Math.random() * options.length)
        ];

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

    toastTimer = setTimeout(() => {
      toastEl.classList.remove("show");
    }, 900);
  }

  function kick() {
    if (!running || player.kickCd > 0) return;

    player.kickCd = CFG.kickCooldown;

    let target = null;
    let best = Infinity;

    for (const r of rivals) {
      if (r.state !== "ride") continue;

      const dx = r.x - player.x;
      const adx = Math.abs(dx);

      if (
        Math.abs(r.z) < CFG.kickReachZ &&
        adx > CFG.kickReachXMin &&
        adx < CFG.kickReachXMax
      ) {
        const d = Math.abs(r.z) + adx * 0.5;

        if (d < best) {
          best = d;
          target = r;
        }
      }
    }

    player.kickSide = target
      ? Math.sign(target.x - player.x) || 1
      : player.lastSide;

    player.kickT = 0.28;

    if (!target) return;

    target.hits++;
    target.flash = 0.25;
    target.wobble = 0.5;
    target.x += player.kickSide * 0.12;
    target.tx = target.x;

    shake = 0.15;
    play("kick");

    if (target.hits >= CFG.kicksToDrop) {
      target.state = "fallen";
      target.fallDir = player.kickSide;
      target.fallT = 0;

      kos++;
      play("fall");
      toast("KNOCKED DOWN!");
    } else {
      toast(`HIT ${target.hits}/${CFG.kicksToDrop}`);
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
        r.z -= player.speed * dt * 0.9;
        r.x += r.fallDir * dt * 0.9 * Math.max(0, 1 - r.fallT);
        continue;
      }

      // Close the gap fast when far, then ease off
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
      if (!r.closed && r.z < 1.8) {
        r.closed = true;
        r.laneT = 0;
      }

      // Lane choice
      r.laneT -= dt;

      if (r.laneT <= 0) {
        r.laneT = 1.5 + Math.random() * 2.5;

        if (Math.abs(r.z) < 2) {
          const side = Math.random() < 0.5 ? -1 : 1;
          let nx = player.x + side * (0.6 + Math.random() * 0.3);

          if (Math.abs(nx) > CFG.xLimit) {
            nx = player.x - side * 0.75;
          }

          r.tx = Math.max(-CFG.xLimit, Math.min(CFG.xLimit, nx));
        } else {
          r.tx = CFG.lanes[Math.floor(Math.random() * 3)];
        }
      }

      const dx = r.tx - r.x;
      r.x += Math.sign(dx) * Math.min(Math.abs(dx), 0.7 * dt);

      // Crash into the player
      if (
        Math.abs(r.z) < 0.16 &&
        Math.abs(r.x - player.x) < 0.3 &&
        player.bumpT <= 0
      ) {
        player.bumpT = 0.9;
        shake = 0.3;

        const push = Math.sign(r.x - player.x) || 1;
        r.tx = Math.max(
          -CFG.xLimit,
          Math.min(CFG.xLimit, r.x + push * 0.6)
        );

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
    document.getElementById("speed").textContent =
      Math.round(sf * CFG.displayTopKmh);

    document.getElementById("kos").textContent = kos;
    document.getElementById("dist").textContent =
      (travelled / 250).toFixed(1);
  }

  // ---------- Drawing ----------
  function drawSky() {
    const g = ctx.createLinearGradient(0, 0, 0, horizon);
    g.addColorStop(0, "#5b8fe0");
    g.addColorStop(1, "#b9d4ff");

    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, horizon + 1);

    const off = -camX() * 40;

    ctx.fillStyle = "#7d8ea6";
    ctx.beginPath();
    ctx.moveTo(-50, horizon);

    for (let i = -1; i <= 12; i++) {
      const x = i * (W / 10) + off;
      const y =
        horizon - 25 -
        22 * Math.sin(i * 1.7) -
        12 * Math.cos(i * 0.9);

      ctx.lineTo(x, y);
    }

    ctx.lineTo(W + 50, horizon);
    ctx.fill();

    ctx.fillStyle = "rgba(255,255,255,0.85)";

    for (let i = 0; i < 4; i++) {
      const cx =
        ((i * 157 + off * 0.5) % (W + 160) + W + 160) %
          (W + 160) -
        80;

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

    for (
      let y = Math.floor(horizon) + 1;
      y < H;
      y += 2
    ) {
      const s = (y - horizon) / camH;
      const z = 1 / s - 1;
      const wz = z + travelled;
      const stripe = Math.floor(wz / seg) % 2 === 0;
      const fog = Math.min(1, z / 40);

      const centre = W / 2 - cxShift * ppu * s;
      const half = CFG.roadHalf * ppu * s;
      const rumble = half * 0.07;

      ctx.fillStyle = mix(
        stripe ? "#5c9a3a" : "#538c33",
        "#b9d4ff",
        fog * 0.6
      );

      ctx.fillRect(0, y, W, 2);

      ctx.fillStyle = mix(
        stripe ? "#bbbbbb" : "#9a9a9a",
        "#b9d4ff",
        fog * 0.6
      );

      ctx.fillRect(
        centre - half - rumble * 3,
        y,
        (half + rumble * 3) * 2,
        2
      );

      ctx.fillStyle = stripe ? "#d33" : "#eee";

      ctx.fillRect(
        centre - half - rumble,
        y,
        (half + rumble) * 2,
        2
      );

      ctx.fillStyle = mix(
        stripe ? "#5a5868" : "#55535f",
        "#b9d4ff",
        fog * 0.5
      );

      ctx.fillRect(centre - half, y, half * 2, 2);

      if (stripe) {
        const lw = Math.max(1, half * 0.022);

        ctx.fillStyle = "#f2f2f2";
        ctx.fillRect(
          centre - half * 0.333 - lw / 2,
          y,
          lw,
          2
        );

        ctx.fillRect(
          centre + half * 0.333 - lw / 2,
          y,
          lw,
          2
        );
      }

      ctx.fillStyle = "#e8c336";

      const ew = Math.max(1, half * 0.015);

      ctx.fillRect(
        centre - half * 0.94,
        y,
        ew,
        2
      );

      ctx.fillRect(
        centre + half * 0.94 - ew,
        y,
        ew,
        2
      );
    }
  }
  function drawScenery() {
    const off = -camX() * 30;

    for (let i = 0; i < 14; i++) {
      const x =
        ((i * 97 + off) % (W + 120) + W + 120) % (W + 120) - 60;

      const y = horizon + 25 + (i % 4) * 15;
      const size = 12 + (i % 5) * 4;

      ctx.fillStyle = "#426b32";
      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "#56863b";
      ctx.beginPath();
      ctx.arc(
        x - size * 0.3,
        y - size * 0.35,
        size * 0.7,
        0,
        Math.PI * 2
      );
      ctx.fill();
    }
  }

  function project(x, z) {
    const s = 1 / (z + 1);
    const scale = ppu * s;

    return {
      x: W / 2 + (x - camX()) * scale,
      y: horizon + camH * s,
      scale
    };
  }

  function drawBike(o, isPlayer = false) {
    const p = project(o.x, o.z);
    const scale = p.scale;
    const x = p.x;
    const y = p.y;

    if (y < horizon - 30 || y > H + 100) return;

    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);

    // Shadow
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.beginPath();
    ctx.ellipse(0, -5, 24, 8, 0, 0, Math.PI * 2);
    ctx.fill();

    // Wheels
    ctx.fillStyle = "#151515";
    ctx.beginPath();
    ctx.ellipse(0, -7, 8, 15, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#777";
    ctx.beginPath();
    ctx.ellipse(0, -7, 3, 10, 0, 0, Math.PI * 2);
    ctx.fill();

    // Bike frame
    ctx.strokeStyle = "#222";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(0, -12);
    ctx.lineTo(-12, -28);
    ctx.lineTo(0, -45);
    ctx.lineTo(13, -28);
    ctx.lineTo(0, -12);
    ctx.stroke();

    // Fuel tank
    ctx.fillStyle = o.color || "#e53935";
    ctx.beginPath();
    ctx.moveTo(-12, -34);
    ctx.quadraticCurveTo(-17, -43, -6, -45);
    ctx.lineTo(8, -42);
    ctx.quadraticCurveTo(16, -38, 10, -31);
    ctx.lineTo(-5, -29);
    ctx.closePath();
    ctx.fill();

    // Seat
    ctx.fillStyle = "#222";
    ctx.fillRect(-9, -48, 18, 5);

    // Rider body
    ctx.fillStyle = o.jacket || "#263238";
    ctx.beginPath();
    ctx.moveTo(-10, -52);
    ctx.lineTo(-14, -78);
    ctx.lineTo(-8, -91);
    ctx.lineTo(8, -91);
    ctx.lineTo(14, -78);
    ctx.lineTo(10, -52);
    ctx.closePath();
    ctx.fill();

    // Arms
    ctx.strokeStyle = o.jacket || "#263238";
    ctx.lineWidth = 7;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(-9, -78);
    ctx.lineTo(-20, -61);
    ctx.lineTo(-10, -49);

    ctx.moveTo(9, -78);
    ctx.lineTo(20, -61);
    ctx.lineTo(10, -49);
    ctx.stroke();

    // Legs
    ctx.strokeStyle = o.pants || "#263238";
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(-7, -53);
    ctx.lineTo(-15, -36);
    ctx.lineTo(-7, -26);

    ctx.moveTo(7, -53);
    ctx.lineTo(15, -36);
    ctx.lineTo(7, -26);
    ctx.stroke();

    // Head: player's photo, cropped into a circle
    if (o.face && faceReady) {
      const headX = 0;
      const headY = -123;
      const radius = 16;

      ctx.save();

      ctx.beginPath();
      ctx.arc(headX, headY, radius, 0, Math.PI * 2);
      ctx.clip();

      const iw = face.naturalWidth;
      const ih = face.naturalHeight;
      const faceScale = (radius * 2) / Math.min(iw, ih);

      ctx.drawImage(
        face,
        headX - (iw * faceScale) / 2,
        headY - (ih * faceScale) / 2,
        iw * faceScale,
        ih * faceScale
      );

      ctx.restore();

      // Thin border around the face
      ctx.strokeStyle = "#e8e8e8";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(headX, headY, radius, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      // Helmet for other riders
      ctx.fillStyle = o.helmet || "#ffca28";
      ctx.beginPath();
      ctx.arc(0, -120, 17, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "rgba(255,255,255,0.25)";
      ctx.beginPath();
      ctx.arc(-6, -127, 5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Kick animation
    if (isPlayer && player.kickT > 0) {
      const kickProgress = player.kickT / 0.28;
      const side = player.kickSide || 1;

      ctx.strokeStyle = "#f4d6b8";
      ctx.lineWidth = 9;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(side * 7, -49);
      ctx.lineTo(
        side * (20 + 20 * (1 - kickProgress)),
        -40
      );
      ctx.stroke();
    }

    // Hit flash
    if (o.flash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${Math.min(0.7, o.flash * 3)})`;
      ctx.fillRect(-25, -135, 50, 110);
    }

    ctx.restore();
  }

    function drawRival(r) {
    const p = project(r.x, r.z);
    let lean = Math.sign(r.tx - r.x) * 0.12;

    if (r.wobble > 0) {
      lean += Math.sin(r.wobble * 40) * 0.15;
    }

    if (r.state === "fallen") {
      lean = r.fallDir * Math.min(1.45, r.fallT * 4);
    }

    drawBike(p.x, p.y, p.s, {
      lean,
      bike: r.colours.bike,
      jacket: r.colours.jacket,
      helmet: r.colours.helmet,
      flash: r.flash,
    });

    // Hit indicators above rivals who have been kicked
    if (r.state === "ride" && r.hits > 0 && r.z < 3) {
      const u = ppu * p.s;

      for (let i = 0; i < CFG.kicksToDrop; i++) {
        ctx.fillStyle =
          i < r.hits ? "#ff3b30" : "rgba(255,255,255,0.6)";

        ctx.beginPath();
        ctx.arc(
          p.x + (i - 1) * u * 0.07,
          p.y - u * 0.95,
          u * 0.025,
          0,
          Math.PI * 2
        );
        ctx.fill();
      }
    }
  }

  function drawPlayer() {
    const p = project(player.x, 0);

    const k = player.kickT > 0
      ? Math.sin((1 - player.kickT / 0.28) * Math.PI)
      : 0;

    const blink =
      player.bumpT > 0 &&
      Math.floor(player.bumpT * 12) % 2 === 0;

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

    if (shake > 0) {
      ctx.translate(
        (Math.random() - 0.5) * 10 * shake * 4,
        (Math.random() - 0.5) * 6 * shake * 4
      );
    }

    drawSky();
    drawRoad();

    const items = sceneryItems();

    rivals.forEach((r) =>
      items.push({
        z: r.z,
        draw: () => drawRival(r),
      })
    );

    items.push({
      z: 0.0001,
      draw: drawPlayer,
    });

    items.sort((a, b) => b.z - a.z);
    items.forEach((i) => i.draw());

    ctx.restore();
  }

  // ---------- Game loop ----------
  let last = performance.now();

  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    if (running) {
      update(dt);
    }

    render();
    requestAnimationFrame(frame);
  }

  reset();
  requestAnimationFrame(frame);
})();
 
