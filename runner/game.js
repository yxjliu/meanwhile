// Bridge Brigade: a number-gate runner. Move left/right, the squad fires on its own.
(() => {
  'use strict';
  const W = 480, H = 800;          // logical canvas size
  const BL = 70, BR = 410, MID = 240; // bridge edges and centre line
  const SQUAD_Y = 670;
  const MAX_N = 999;
  const BEST_KEY = 'mw.runner.best';

  const cvs = document.getElementById('game');
  const ctx = cvs.getContext('2d');
  const keys = new Set();
  const rnd = (a, b) => a + Math.random() * (b - a);
  const rint = (a, b) => Math.floor(rnd(a, b + 1));
  const pick = a => a[Math.floor(Math.random() * a.length)];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  let best = 0;
  try { best = Number(localStorage.getItem(BEST_KEY)) || 0; } catch { /* storage unavailable */ }

  // Sunflower packing for the squad formation.
  const SLOTS = [];
  for (let i = 0; i < 70; i++) {
    const r = 6.4 * Math.sqrt(i), a = i * 2.39996;
    SLOTS.push([Math.cos(a) * r, Math.sin(a) * r * 0.85]);
  }
  SLOTS.sort((p, q) => p[1] - q[1]);

  const SKILLS = {
    rate: { label: 'FIRE RATE', icon: '⚡', apply: s => { s.rate *= 1.2; } },
    dmg: { label: 'DAMAGE', icon: '✦', apply: s => { s.dmg *= 1.3; } },
    pierce: { label: 'PIERCE', icon: '➶', apply: s => { s.pierce += 1; } },
  };

  let S = null;            // run state
  let mode = 'title';      // title | play | paused | over
  let pauseWhy = '';

  function newGame() {
    S = {
      t: 0, dist: 0, stage: 1, points: 0, n: 12, x: MID,
      rate: 1, dmg: 1, pierce: 0, speed: 150, fireCd: 0,
      bullets: [], zombies: [], gates: [], saws: [], fx: [], texts: [], queue: [],
      boss: null, shake: 0, hurt: 0, sawCd: 0, bossCd: 0, banner: 0, got: { rate: 0, dmg: 0, pierce: 0 },
    };
    buildStage();
    mode = 'play';
  }

  const power = () => S.n * S.dmg * S.rate;                 // damage per second if every shot lands
  const hpScale = () => Math.pow(Math.max(power(), 10) / 10, 0.85);
  const squadR = () => 8 + 6.1 * Math.sqrt(Math.min(S.n, 70));
  const score = () => S.points + Math.floor(S.dist / 20);

  // ---------- stage layout ----------
  function buildStage() {
    const s = S.stage;
    let d = S.dist + (s === 1 ? 120 : 320);
    const add = (kind, gap, opt) => { S.queue.push({ at: d, kind, opt: opt || {} }); d += gap; };
    add('gates', 300, { easy: s === 1 });
    add('wave', 400, { n: 5 + s * 2 });
    add('gates', 300);
    add('saw', 260, { n: 1 + (s >= 3 ? 1 : 0) });
    add('wave', 440, { n: 9 + s * 2, brutes: 1 + Math.floor(s / 3), runners: s >= 2 ? s : 0 });
    add('gates', 300);
    if (s >= 2) {
      add('saw', 240, { n: 2 });
      add('wave', 440, { n: 11 + s * 3, brutes: 1 + Math.floor(s / 2), runners: s + 1 });
      add('gates', 300);
    }
    add('boss', 0);
    S.banner = 2.2;
  }

  function spawn(ev) {
    if (ev.kind === 'gates') S.gates.push(makeGates(ev.opt.easy));
    else if (ev.kind === 'wave') {
      const { n = 6, brutes = 0, runners = 0 } = ev.opt;
      for (let i = 0; i < n; i++) addZombie('normal', rnd(BL + 16, BR - 16), -30 - rnd(0, 300));
      for (let i = 0; i < brutes; i++) addZombie('brute', rnd(BL + 30, BR - 30), -120 - rnd(0, 220));
      for (let i = 0; i < runners; i++) addZombie('runner', rnd(BL + 14, BR - 14), -200 - rnd(0, 260));
    } else if (ev.kind === 'saw') {
      for (let i = 0; i < (ev.opt.n || 1); i++) {
        S.saws.push({ x: i % 2 ? BR - 40 : BL + 40, y: -40 - i * 130, r: 24, vx: (i % 2 ? -1 : 1) * rnd(120, 170), rot: 0 });
      }
    } else if (ev.kind === 'boss') {
      const hp = (7 + S.stage) * 1.7 * Math.pow(Math.max(power(), 10), 0.92);
      S.boss = { x: MID, y: -90, r: 46, hp, maxHp: hp, spawnCd: 3, hit: 0 };
      say(MID, 250, 'BOSS', '#ff6b6b', 1.6, 34);
    }
  }

  function addZombie(type, x, y) {
    const k = hpScale() * (1 + 0.12 * (S.stage - 1));
    const def = {
      normal: { r: 11, hp: 3.6, vy: 28, vx: 14, pts: 10 },
      runner: { r: 9, hp: 2.5, vy: 95, vx: 30, pts: 15 },
      brute: { r: 19, hp: 30, vy: 14, vx: 10, pts: 50 },
    }[type];
    S.zombies.push({ type, x, y, r: def.r, hp: def.hp * k, maxHp: def.hp * k, vy: def.vy, vx: def.vx, pts: def.pts, wob: rnd(0, 6), hit: 0 });
  }

  function makeGates(easy) {
    const s = S.stage;
    const num = sign => ({ kind: 'num', value: sign * Math.max(rint(4, 8) + 2 * s, Math.round(S.n * rnd(0.12, 0.25))) });
    const add = () => num(1), sub = () => num(-1);
    const mul = () => (S.n >= 150 ? add() : { kind: 'mul', value: 2 });
    const div = () => ({ kind: 'div', value: 2 });
    const skill = () => ({ kind: 'skill', skill: pick(Object.keys(SKILLS)) });
    const pair = easy ? [add, mul] : pick([
      [add, mul], [add, sub], [add, sub], [mul, div], [add, skill], [skill, sub],
      [sub, sub], [sub, sub], [add, add], [div, add], [mul, sub], [div, sub],
    ]);
    const sides = pair.map(f => f());
    if (Math.random() < 0.5) sides.reverse();
    return { y: -30, L: sides[0], R: sides[1], done: false };
  }

  // ---------- effects ----------
  function say(x, y, text, color, life = 0.9, size = 20) { S.texts.push({ x, y, text, color, life, max: life, size }); }
  function burst(x, y, color, n = 8, sp = 120) {
    for (let i = 0; i < n; i++) {
      const a = rnd(0, Math.PI * 2), v = rnd(sp * 0.3, sp);
      S.fx.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rnd(0.25, 0.5), color, size: rnd(2, 4.5) });
    }
  }
  function lose(k) {
    k = Math.min(S.n, Math.max(1, Math.round(k)));
    S.n -= k;
    S.hurt = 0.25;
    S.shake = 6;
    say(S.x + rnd(-14, 14), SQUAD_Y - squadR() - 26, '-' + k, '#ff6b6b');
    if (S.n <= 0) gameOver();
  }
  function gameOver() {
    mode = 'over';
    S.final = score();
    if (S.final > best) {
      best = S.final;
      S.newBest = true;
      try { localStorage.setItem(BEST_KEY, String(best)); } catch { /* storage unavailable */ }
    }
  }

  function applyGate(side, x) {
    const before = S.n;
    let text, color = '#5aa9ff';
    if (side.kind === 'num') {
      const v = Math.trunc(side.value);
      S.n = clamp(S.n + v, 0, MAX_N);
      text = (v >= 0 ? '+' : '−') + Math.abs(v);
      if (v < 0) color = '#ff6b6b';
    } else if (side.kind === 'mul') {
      S.n = Math.min(MAX_N, S.n * side.value);
      text = '×' + side.value;
    } else if (side.kind === 'div') {
      S.n = Math.max(1, Math.ceil(S.n / side.value));
      text = '÷' + side.value;
      color = '#ff6b6b';
    } else {
      SKILLS[side.skill].apply(S);
      S.got[side.skill]++;
      text = SKILLS[side.skill].label + ' UP';
      color = '#ffb84d';
    }
    say(x, SQUAD_Y - 70, text, color, 1.1, 26);
    if (S.n > before) burst(S.x, SQUAD_Y, '#5aa9ff', 14, 160);
    if (S.n < before) { S.hurt = 0.25; S.shake = 5; }
    if (S.n <= 0) gameOver();
  }

  function fire(R) {
    const count = clamp(Math.round(Math.sqrt(S.n)), 1, 9);
    const dmg = (S.n * S.dmg * 0.16) / count;
    const spread = Math.min(R * 1.5, 104);
    for (let i = 0; i < count; i++) {
      const off = count === 1 ? 0 : (i / (count - 1) - 0.5) * spread;
      S.bullets.push({ x: S.x + off + rnd(-2, 2), y: SQUAD_Y - R * 0.6, dmg, share: 1 / count, pierce: S.pierce, seen: null });
    }
  }

  function killZombie(z) {
    z.dead = true;
    S.points += z.pts;
    burst(z.x, z.y, z.type === 'brute' ? '#b98cff' : '#7bd66b', z.type === 'brute' ? 16 : 7);
  }

  function bossDown() {
    const b = S.boss;
    burst(b.x, b.y, '#ff6b6b', 40, 260);
    burst(b.x, b.y, '#ffb84d', 30, 200);
    S.points += 500 * S.stage;
    S.shake = 10;
    S.boss = null;
    S.stage += 1;
    S.speed = Math.min(230, S.speed + 9);
    for (const z of S.zombies) if (!z.dead) killZombie(z);
    buildStage();
  }

  // ---------- update ----------
  function update(dt) {
    S.t += dt;
    const v = S.speed;
    S.dist += v * dt;
    S.shake = Math.max(0, S.shake - dt * 30);
    S.hurt = Math.max(0, S.hurt - dt);
    S.banner = Math.max(0, S.banner - dt);

    const dir = (keys.has('ArrowRight') || keys.has('d') ? 1 : 0) - (keys.has('ArrowLeft') || keys.has('a') ? 1 : 0);
    const R = squadR();
    const pad = Math.min(R, 44);
    S.x = clamp(S.x + dir * 390 * dt, BL + pad, BR - pad);

    while (S.queue.length && S.dist >= S.queue[0].at) spawn(S.queue.shift());

    S.fireCd -= dt;
    if (S.fireCd <= 0) { S.fireCd = 0.16 / S.rate; fire(R); }

    for (const g of S.gates) g.y += v * dt;
    for (const z of S.zombies) {
      z.y += (v + z.vy) * dt;
      // Drift far away, then close in fast so nobody simply walks past the squad.
      const chase = z.y > 420 ? Math.max(z.vx, 75) : z.vx;
      if (z.y > -10) z.x = clamp(z.x + clamp(S.x - z.x, -1, 1) * chase * dt, BL + z.r, BR - z.r);
      z.wob += dt * 9;
      z.hit = Math.max(0, z.hit - dt);
    }
    for (const s of S.saws) {
      s.y += v * dt;
      s.x += s.vx * dt;
      if (s.x < BL + s.r) { s.x = BL + s.r; s.vx = Math.abs(s.vx); }
      if (s.x > BR - s.r) { s.x = BR - s.r; s.vx = -Math.abs(s.vx); }
      s.rot += dt * 10;
    }

    const boss = S.boss;
    if (boss) {
      boss.y += (boss.y < 170 ? 70 : 20) * dt;
      boss.x = clamp(boss.x + clamp(S.x - boss.x, -1, 1) * 34 * dt, BL + boss.r, BR - boss.r);
      boss.hit = Math.max(0, boss.hit - dt);
      boss.spawnCd -= dt;
      if (boss.spawnCd <= 0) {
        boss.spawnCd = 2.6;
        for (let i = 0; i < 2 + Math.min(3, Math.floor(S.stage / 2)); i++) addZombie('normal', rnd(BL + 16, BR - 16), -20 - i * 34);
      }
    }

    // bullets
    for (const b of S.bullets) {
      b.y -= 640 * dt;
      if (b.y < -20) { b.dead = true; continue; }
      // gates soak up shots and grow
      for (const g of S.gates) {
        if (g.done || b.y > g.y || b.y < g.y - 50) continue;
        const side = b.x < MID ? g.L : g.R;
        if (side.kind !== 'num') continue;
        side.value += b.share * (0.5 + 0.15 * S.stage) * Math.max(1, S.n / 80);
        side.flash = 0.08;
        b.dead = true;
        break;
      }
      if (b.dead) continue;
      const bs = S.boss;
      if (bs && Math.hypot(b.x - bs.x, b.y - bs.y) < bs.r + 3) {
        bs.hp -= b.dmg;
        bs.hit = 0.06;
        b.dead = true;
        if (bs.hp <= 0) bossDown();
        continue;
      }
      for (const z of S.zombies) {
        if (z.dead || z === b.seen) continue;
        if (Math.abs(b.x - z.x) < z.r + 3 && Math.abs(b.y - z.y) < z.r + 7) {
          z.hp -= b.dmg;
          z.hit = 0.06;
          if (z.hp <= 0) killZombie(z);
          if (b.pierce > 0) { b.pierce--; b.seen = z; } else { b.dead = true; }
          break;
        }
      }
    }

    // gates reach the squad
    for (const g of S.gates) {
      if (g.L.flash) g.L.flash = Math.max(0, g.L.flash - dt);
      if (g.R.flash) g.R.flash = Math.max(0, g.R.flash - dt);
      if (!g.done && g.y >= SQUAD_Y - 8) {
        g.done = true;
        applyGate(S.x < MID ? g.L : g.R, S.x < MID ? (BL + MID) / 2 : (MID + BR) / 2);
      }
    }
    if (mode !== 'play') return;

    // zombies reach the squad
    for (const z of S.zombies) {
      if (z.dead) continue;
      if (z.y > H + 40) { z.dead = true; continue; }
      if (Math.abs(z.y - SQUAD_Y) < R * 0.85 + z.r && Math.abs(z.x - S.x) < R + z.r * 0.7) {
        z.dead = true;
        burst(z.x, z.y, '#ff6b6b', 6);
        lose(z.type === 'brute' ? Math.max(3, S.n * 0.2) : z.type === 'runner' ? Math.max(1, S.n * 0.04) : Math.max(1, S.n * 0.04));
        if (mode !== 'play') return;
      }
    }
    // saws grind while they overlap
    S.sawCd -= dt;
    for (const s of S.saws) {
      if (Math.hypot(s.x - S.x, s.y - SQUAD_Y) < s.r + R * 0.8 && S.sawCd <= 0) {
        S.sawCd = 0.12;
        lose(Math.max(1, S.n * 0.07));
        if (mode !== 'play') return;
      }
    }
    if (boss && S.boss) {
      S.bossCd -= dt;
      if (boss.y + boss.r > SQUAD_Y - R && Math.abs(boss.x - S.x) < boss.r + R && S.bossCd <= 0) {
        S.bossCd = 0.25;
        lose(Math.max(2, S.n * 0.15));
        if (mode !== 'play') return;
      }
    }

    for (const p of S.fx) { p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; }
    for (const t of S.texts) { t.y -= 34 * dt; t.life -= dt; }
    S.bullets = S.bullets.filter(b => !b.dead);
    S.zombies = S.zombies.filter(z => !z.dead);
    S.gates = S.gates.filter(g => g.y < H + 60 && !(g.done && g.y > SQUAD_Y + 30));
    S.saws = S.saws.filter(s => s.y < H + 60);
    S.fx = S.fx.filter(p => p.life > 0);
    S.texts = S.texts.filter(t => t.life > 0);
  }

  // ---------- drawing ----------
  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function label(text, x, y, size, color, align = 'center', weight = 700) {
    ctx.font = `${weight} ${size}px system-ui, "Segoe UI", sans-serif`;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  }

  function drawWorld(dist) {
    ctx.fillStyle = '#0d2a3d';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(140, 200, 230, 0.18)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 26; i++) {
      const x = (i * 97) % W, y = ((i * 71 + dist * 0.45) % (H + 40)) - 20;
      if (x > BL - 24 && x < BR + 8) continue;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 16, y); ctx.stroke();
    }
    ctx.fillStyle = '#3a3f52';
    ctx.fillRect(BL, 0, BR - BL, H);
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.22)';
    ctx.lineWidth = 1;
    for (let y = (dist % 40) - 40; y < H; y += 40) { ctx.beginPath(); ctx.moveTo(BL, y); ctx.lineTo(BR, y); ctx.stroke(); }
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.10)';
    ctx.lineWidth = 3;
    ctx.setLineDash([18, 22]);
    ctx.lineDashOffset = -dist;
    ctx.beginPath(); ctx.moveTo(MID, 0); ctx.lineTo(MID, H); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#8a8fa8';
    ctx.fillRect(BL - 7, 0, 7, H);
    ctx.fillRect(BR, 0, 7, H);
    ctx.fillStyle = '#5c617a';
    for (let y = (dist % 80) - 80; y < H; y += 80) { ctx.fillRect(BL - 10, y, 13, 8); ctx.fillRect(BR - 3, y, 13, 8); }
  }

  function gateStyle(side) {
    if (side.kind === 'skill') return { fill: 'rgba(255, 184, 77, 0.38)', edge: '#ffb84d', text: SKILLS[side.skill].icon + ' ' + SKILLS[side.skill].label, size: 15 };
    let good, text;
    if (side.kind === 'num') { const v = Math.trunc(side.value); good = v >= 0; text = (good ? '+' : '−') + Math.abs(v); }
    else if (side.kind === 'mul') { good = true; text = '×' + side.value; }
    else { good = false; text = '÷' + side.value; }
    return good
      ? { fill: 'rgba(90, 169, 255, 0.40)', edge: '#5aa9ff', text, size: 24 }
      : { fill: 'rgba(255, 107, 107, 0.40)', edge: '#ff6b6b', text, size: 24 };
  }
  function drawGates() {
    for (const g of S.gates) {
      const alpha = g.done ? 0.25 : 1;
      [[g.L, BL, MID], [g.R, MID, BR]].forEach(([side, x0, x1]) => {
        const st = gateStyle(side);
        ctx.globalAlpha = alpha;
        ctx.fillStyle = side.flash ? 'rgba(255, 255, 255, 0.55)' : st.fill;
        ctx.fillRect(x0 + 3, g.y - 46, x1 - x0 - 6, 46);
        ctx.strokeStyle = st.edge;
        ctx.lineWidth = 3;
        ctx.strokeRect(x0 + 3, g.y - 46, x1 - x0 - 6, 46);
        label(st.text, (x0 + x1) / 2, g.y - 22, st.size, '#fff');
      });
      ctx.globalAlpha = 1;
    }
  }

  function drawZombie(z) {
    const body = z.hit ? '#fff' : z.type === 'brute' ? '#9a6fe0' : z.type === 'runner' ? '#c9d94f' : '#7bd66b';
    const sway = Math.sin(z.wob) * 2;
    ctx.fillStyle = body;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.lineWidth = 2;
    ctx.fillRect(z.x - z.r - 3, z.y + sway, 5, z.r * 0.9);
    ctx.fillRect(z.x + z.r - 2, z.y - sway, 5, z.r * 0.9);
    ctx.beginPath(); ctx.arc(z.x, z.y, z.r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#1a2416';
    ctx.beginPath();
    ctx.arc(z.x - z.r * 0.35, z.y + z.r * 0.2, z.r * 0.16, 0, Math.PI * 2);
    ctx.arc(z.x + z.r * 0.35, z.y + z.r * 0.2, z.r * 0.16, 0, Math.PI * 2);
    ctx.fill();
    if (z.type === 'brute' && z.hp < z.maxHp) bar(z.x, z.y - z.r - 8, 34, z.hp / z.maxHp);
  }
  function bar(x, y, w, frac) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.fillRect(x - w / 2, y, w, 5);
    ctx.fillStyle = '#ff6b6b';
    ctx.fillRect(x - w / 2, y, w * clamp(frac, 0, 1), 5);
  }
  function drawBoss() {
    const b = S.boss;
    if (!b) return;
    ctx.fillStyle = b.hit ? '#fff' : '#c2453f';
    ctx.strokeStyle = '#2a0f0d';
    ctx.lineWidth = 4;
    ctx.fillRect(b.x - b.r - 10, b.y - 6, 14, b.r);
    ctx.fillRect(b.x + b.r - 4, b.y - 6, 14, b.r);
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#ffe9a8';
    ctx.beginPath();
    ctx.arc(b.x - 16, b.y + 10, 7, 0, Math.PI * 2);
    ctx.arc(b.x + 16, b.y + 10, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#2a0f0d';
    ctx.fillRect(b.x - 18, b.y + 26, 36, 6);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    roundRect(BL + 20, 62, BR - BL - 40, 12, 6); ctx.fill();
    ctx.fillStyle = '#ff6b6b';
    roundRect(BL + 20, 62, Math.max(12, (BR - BL - 40) * clamp(b.hp / b.maxHp, 0, 1)), 12, 6); ctx.fill();
  }
  function drawSaws() {
    for (const s of S.saws) {
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(s.rot);
      ctx.fillStyle = '#d7dbe8';
      ctx.beginPath();
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2, r = i % 2 ? s.r : s.r * 0.72;
        ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#ff6b6b';
      ctx.beginPath(); ctx.arc(0, 0, s.r * 0.3, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }
  function drawSquad() {
    const shown = Math.min(S.n, SLOTS.length);
    const hurt = S.hurt > 0;
    for (let i = 0; i < SLOTS.length; i++) {
      // SLOTS is sorted by y; keep only the innermost `shown` soldiers.
      const [ox, oy] = SLOTS[i];
      if (ox * ox + (oy / 0.85) * (oy / 0.85) > 6.4 * 6.4 * shown) continue;
      const x = S.x + ox, y = SQUAD_Y + oy;
      ctx.fillStyle = hurt ? '#ff9c9c' : '#5aa9ff';
      ctx.strokeStyle = '#173a63';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#173a63';
      ctx.fillRect(x - 1, y - 9, 2, 5);
    }
    const R = squadR();
    const text = S.n >= MAX_N ? `${MAX_N} MAX` : String(S.n);
    ctx.font = '700 17px system-ui, "Segoe UI", sans-serif';
    const w = ctx.measureText(text).width + 18;
    ctx.fillStyle = hurt ? '#ff6b6b' : '#5aa9ff';
    roundRect(S.x - w / 2, SQUAD_Y - R - 30, w, 22, 11); ctx.fill();
    label(text, S.x, SQUAD_Y - R - 18, 17, '#08182b');
  }
  function drawHud() {
    ctx.fillStyle = 'rgba(8, 12, 24, 0.55)';
    ctx.fillRect(0, 0, W, 46);
    label('STAGE ' + S.stage, 14, 23, 15, '#ffb84d', 'left');
    label(String(mode === 'over' ? S.final : score()), MID, 23, 22, '#fff');
    label('BEST ' + best, W - 14, 23, 15, '#9aa0bf', 'right');
    const got = Object.keys(SKILLS).filter(k => S.got[k]).map(k => `${SKILLS[k].icon}${S.got[k]}`).join('  ');
    if (got) label(got, 14, H - 18, 15, '#ffb84d', 'left');
    if (S.banner > 0 && mode === 'play') {
      ctx.globalAlpha = Math.min(1, S.banner);
      label('STAGE ' + S.stage, MID, 300, 40, '#fff');
      ctx.globalAlpha = 1;
    }
  }
  function overlay(title, lines, tint = 'rgba(8, 12, 24, 0.78)') {
    ctx.fillStyle = tint;
    ctx.fillRect(0, 0, W, H);
    label(title, MID, 300, 40, '#fff');
    lines.forEach((l, i) => label(l[0], MID, 360 + i * 30, l[2] || 17, l[1] || '#c9cde6', 'center', l[3] || 500));
  }

  function draw() {
    const dist = S ? S.dist : performance.now() * 0.06;
    ctx.save();
    if (S && S.shake > 0 && mode === 'play') ctx.translate(rnd(-S.shake, S.shake), rnd(-S.shake, S.shake));
    drawWorld(dist);
    if (S) {
      drawGates();
      drawSaws();
      for (const z of S.zombies) drawZombie(z);
      drawBoss();
      ctx.fillStyle = '#ffe9a8';
      for (const b of S.bullets) ctx.fillRect(b.x - 1.5, b.y - 6, 3, 10);
      if (S.n > 0) drawSquad();
      for (const p of S.fx) { ctx.globalAlpha = clamp(p.life * 3, 0, 1); ctx.fillStyle = p.color; ctx.fillRect(p.x, p.y, p.size, p.size); }
      ctx.globalAlpha = 1;
      for (const t of S.texts) { ctx.globalAlpha = clamp(t.life / t.max * 2, 0, 1); label(t.text, t.x, t.y, t.size, t.color); }
      ctx.globalAlpha = 1;
    }
    ctx.restore();
    if (S) drawHud();

    if (mode === 'title') {
      overlay('BRIDGE BRIGADE', [
        ['← →  or  A D  to move. The squad fires by itself.'],
        ['Walk through blue gates, steer clear of red ones.'],
        ['Shoot a number gate to raise it before you reach it.'],
        ['Dodge the saws. Kill the boss to clear the stage.'],
        [''],
        ['Press Space to start', '#ffb84d', 20, 700],
      ]);
    } else if (mode === 'paused') {
      overlay('PAUSED', [
        [pauseWhy || 'Take your time.', '#ffb84d', 18, 700],
        [''],
        ['Press Space to carry on'],
      ]);
    } else if (mode === 'over') {
      overlay('SQUAD LOST', [
        [`Score ${S.final}  ·  Stage ${S.stage}`, '#fff', 22, 700],
        [S.newBest ? 'New best!' : `Best ${best}`, S.newBest ? '#4fd18b' : '#9aa0bf', 18, 700],
        [''],
        ['Press Space to go again', '#ffb84d', 20, 700],
      ], 'rgba(40, 8, 12, 0.80)');
    }
  }

  // ---------- loop, input, sizing ----------
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;
    if (mode === 'play') update(dt);
    draw();
    requestAnimationFrame(frame);
  }

  function pause(why) {
    if (mode !== 'play') return;
    mode = 'paused';
    pauseWhy = why || '';
    keys.clear();
  }

  function fit() {
    const barEl = document.querySelector('.mw-bar');
    const top = barEl ? barEl.offsetHeight : 46;
    const scale = Math.max(0.2, Math.min((innerHeight - top - 20) / H, (innerWidth - 20) / W));
    const dpr = Math.min(devicePixelRatio || 1, 2);
    cvs.style.width = Math.floor(W * scale) + 'px';
    cvs.style.height = Math.floor(H * scale) + 'px';
    cvs.width = Math.floor(W * scale * dpr);
    cvs.height = Math.floor(H * scale * dpr);
    ctx.setTransform(cvs.width / W, 0, 0, cvs.height / H, 0, 0);
  }

  addEventListener('keydown', e => {
    if (e.target instanceof HTMLSelectElement) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' '].includes(k)) e.preventDefault();
    if (k === ' ' || k === 'Enter') {
      if (e.repeat) return;
      if (mode === 'title' || mode === 'over') newGame();
      else if (mode === 'paused') { mode = 'play'; last = performance.now(); }
      return;
    }
    if (k === 'p' || k === 'Escape') {
      if (mode === 'play') pause('');
      else if (mode === 'paused') { mode = 'play'; last = performance.now(); }
      return;
    }
    keys.add(k);
  });
  addEventListener('keyup', e => keys.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key));
  addEventListener('blur', () => pause(''));
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(''); });
  addEventListener('meanwhile:attention', () => pause('Claude wants you. Go take a look.'));
  addEventListener('resize', fit);

  fit();
  requestAnimationFrame(frame);

  // Small handle for testing from the console.
  window.BridgeBrigade = { state: () => S, mode: () => mode, start: newGame, step: update };
})();
