// Tiny Hero: drawing, input and run flow. The rules live in core.js.
(() => {
  'use strict';
  const W = 760, H = 640, HUD = 54;
  const RUN_KEY = 'mw.hero.run', BEST_KEY = 'mw.hero.best';
  const cvs = document.getElementById('game');
  const ctx = cvs.getContext('2d');
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
    del(k) { try { localStorage.removeItem(k); } catch { /* storage unavailable */ } },
  };
  const rnd = (a, b) => a + Math.random() * (b - a);
  const fmt = n => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 10000 ? (n / 1000).toFixed(1) + 'K' : String(n));

  let best = store.get(BEST_KEY, 0);
  let run = null;           // { stage, st, initial, tiers }
  let mode = 'title';       // title | play | clear | over
  let stuck = false, bonusHeart = false;
  let fx = [], texts = [];
  let shake = 0, flash = 0, clearT = 0, spot = 0;
  const shown = new Map();  // smooth on-screen positions, keyed by thing id ('hero' for the hero)

  // ---------- run flow ----------
  function tiersFor(things) {
    const foes = things.filter(t => t.kind === 'enemy').sort((a, b) => a.v - b.v);
    const tiers = {};
    foes.forEach((e, i) => { tiers[e.id] = e.boss ? 3 : Math.min(2, Math.floor((i / Math.max(1, foes.length - 1)) * 3)); });
    return tiers;
  }
  function startStage(stage, hearts) {
    const st = HeroCore.newState(HeroCore.generate(stage), hearts);
    run = { stage, st, initial: JSON.stringify(st), tiers: tiersFor(st.things) };
    enter();
  }
  function enter() {
    mode = 'play';
    spot = 1.6;
    stuck = HeroCore.isStuck(run.st);
    shown.clear();
    fx = []; texts = [];
    save();
  }
  function restartStage() {
    const hearts = run.st.hearts;
    run.st = JSON.parse(run.initial);
    run.st.hearts = hearts;
    enter();
  }
  function save() {
    if (mode === 'over') store.del(RUN_KEY); else store.set(RUN_KEY, run);
  }

  function geom() {
    const st = run.st;
    const T = Math.floor(Math.min(84, (W - 24) / st.cols, (H - HUD - 44) / st.rows));
    return { T, ox: Math.round((W - T * st.cols) / 2), oy: Math.round(HUD + (H - HUD - 30 - T * st.rows) / 2) };
  }
  const centre = (g, x, y) => [g.ox + (x + 0.5) * g.T, g.oy + (y + 0.5) * g.T];

  function say(g, x, y, text, color, size = 22) {
    const [cx, cy] = centre(g, x, y);
    texts.push({ x: cx, y: cy - g.T * 0.3, text, color, size, life: 1, max: 1 });
  }
  function burst(g, x, y, color, n = 12) {
    const [cx, cy] = centre(g, x, y);
    for (let i = 0; i < n; i++) {
      const a = rnd(0, Math.PI * 2), v = rnd(40, 190);
      fx.push({ x: cx, y: cy, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rnd(0.25, 0.55), color, size: rnd(3, 6) });
    }
  }

  function act(dx, dy) {
    if (mode !== 'play') return;
    const st = run.st, g = geom();
    for (const e of HeroCore.move(st, dx, dy)) {
      if (e.type === 'beat') {
        burst(g, e.x, e.y, e.boss ? '#b98cff' : '#ffb84d', e.boss ? 34 : 14);
        say(g, e.x, e.y, '+' + fmt(e.gain), '#4fd18b', e.boss ? 30 : 22);
        if (e.boss) shake = 9;
      } else if (e.type === 'hurt') {
        shake = 9; flash = 0.3;
        say(g, st.x, st.y, '−1 ♥', '#ff6b6b', 24);
      } else if (e.type === 'pickup') {
        burst(g, e.x, e.y, e.kind === 'relic' ? '#ffd166' : '#4fd18b', 10);
        say(g, e.x, e.y, e.kind === 'relic' ? '×' + e.v : '+' + fmt(e.v), e.kind === 'relic' ? '#ffd166' : '#4fd18b', 24);
      } else if (e.type === 'spike') {
        shake = 4;
        say(g, e.x, e.y, '−' + fmt(e.v), '#ff6b6b');
      }
    }
    if (st.hearts <= 0) {
      mode = 'over';
      if (run.stage > best) { best = run.stage; store.set(BEST_KEY, best); }
    } else if (st.cleared) {
      mode = 'clear';
      clearT = 1.5;
      bonusHeart = run.stage % 3 === 0 && st.hearts < HeroCore.MAX_HEARTS;
      if (bonusHeart) st.hearts += 1;
      if (run.stage > best) { best = run.stage; store.set(BEST_KEY, best); }
    } else {
      stuck = HeroCore.isStuck(st);
    }
    save();
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
  function pill(text, cx, cy, size, bg, fg) {
    ctx.font = `800 ${size}px system-ui, "Segoe UI", sans-serif`;
    const w = Math.max(size * 1.5, ctx.measureText(text).width + size * 0.8), h = size * 1.35;
    ctx.fillStyle = bg;
    roundRect(cx - w / 2, cy - h / 2, w, h, h / 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    label(text, cx, cy + 1, size, fg, 'center', 800);
  }
  const eyes = (x, y, r, dy = 0) => {
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(x - r * 0.36, y + dy, r * 0.2, 0, 7); ctx.arc(x + r * 0.36, y + dy, r * 0.2, 0, 7); ctx.fill();
    ctx.fillStyle = '#1a1c2c';
    ctx.beginPath(); ctx.arc(x - r * 0.33, y + dy + r * 0.03, r * 0.1, 0, 7); ctx.arc(x + r * 0.39, y + dy + r * 0.03, r * 0.1, 0, 7); ctx.fill();
  };

  function drawEnemy(t, cx, cy, T, tier, bob) {
    const r = T * [0.25, 0.28, 0.31, 0.37][tier];
    const y = cy + T * 0.08 + bob;
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
    if (tier === 0) {              // slime
      ctx.fillStyle = '#7bd66b';
      ctx.beginPath(); ctx.ellipse(cx, y + r * 0.35, r * 1.05, r * 0.95, 0, Math.PI, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
      eyes(cx, y, r, -r * 0.1);
    } else if (tier === 1) {       // goblin
      ctx.fillStyle = '#f0a04b';
      ctx.beginPath(); ctx.moveTo(cx - r * 0.7, y - r * 0.3); ctx.lineTo(cx - r * 1.5, y - r * 0.8); ctx.lineTo(cx - r * 0.9, y + r * 0.2); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx + r * 0.7, y - r * 0.3); ctx.lineTo(cx + r * 1.5, y - r * 0.8); ctx.lineTo(cx + r * 0.9, y + r * 0.2); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.arc(cx, y, r, 0, 7); ctx.fill(); ctx.stroke();
      eyes(cx, y, r, -r * 0.1);
    } else {                       // ogre and boss
      ctx.fillStyle = tier === 3 ? '#9a6fe0' : '#e0605a';
      roundRect(cx - r, y - r, r * 2, r * 2, r * 0.45); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#f3ead2';
      for (const s of [-1, 1]) {
        ctx.beginPath(); ctx.moveTo(cx + s * r * 0.75, y - r * 0.9); ctx.lineTo(cx + s * r * 1.15, y - r * 1.55); ctx.lineTo(cx + s * r * 0.3, y - r * 0.98); ctx.closePath(); ctx.fill(); ctx.stroke();
      }
      eyes(cx, y, r, -r * 0.15);
      ctx.fillStyle = '#1a1c2c';
      ctx.fillRect(cx - r * 0.45, y + r * 0.35, r * 0.9, r * 0.14);
      if (tier === 3) {            // crown
        ctx.fillStyle = '#ffd166';
        ctx.beginPath();
        ctx.moveTo(cx - r * 0.5, y - r * 0.95); ctx.lineTo(cx - r * 0.5, y - r * 1.5); ctx.lineTo(cx - r * 0.2, y - r * 1.2);
        ctx.lineTo(cx, y - r * 1.6); ctx.lineTo(cx + r * 0.2, y - r * 1.2); ctx.lineTo(cx + r * 0.5, y - r * 1.5); ctx.lineTo(cx + r * 0.5, y - r * 0.95);
        ctx.closePath(); ctx.fill(); ctx.stroke();
      }
    }
  }

  function drawHero(cx, cy, T) {
    const r = T * 0.27, y = cy + T * 0.04;
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = '#102a4a';
    ctx.fillStyle = '#e8eaf6';                       // sword
    ctx.save(); ctx.translate(cx + r * 1.05, y - r * 0.1); ctx.rotate(0.35);
    ctx.fillRect(-r * 0.09, -r * 1.2, r * 0.18, r * 1.3); ctx.strokeRect(-r * 0.09, -r * 1.2, r * 0.18, r * 1.3);
    ctx.fillStyle = '#ffb84d'; ctx.fillRect(-r * 0.3, r * 0.05, r * 0.6, r * 0.14);
    ctx.restore();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 6;      // white rim so the hero pops off the floor
    ctx.beginPath(); ctx.arc(cx, y, r, 0, 7); ctx.stroke();
    ctx.strokeStyle = '#102a4a'; ctx.lineWidth = 2.5;
    ctx.fillStyle = flash > 0 ? '#ff9c9c' : '#5aa9ff';
    ctx.beginPath(); ctx.arc(cx, y, r, 0, 7); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#2b6cb8';                       // helmet
    ctx.beginPath(); ctx.arc(cx, y, r, Math.PI * 1.08, Math.PI * 1.92); ctx.closePath(); ctx.fill(); ctx.stroke();
    eyes(cx, y, r, r * 0.12);
  }

  function drawThing(t, cx, cy, T, time) {
    const st = run.st;
    if (t.kind === 'enemy') {
      drawEnemy(t, cx, cy, T, run.tiers[t.id] ?? 1, Math.sin(time * 3 + t.id) * T * 0.02);
      const win = st.power > t.v;
      pill(fmt(t.v), cx, cy - T * 0.33, Math.max(13, T * 0.21), win ? '#4fd18b' : '#ff6b6b', '#10131f');
    } else if (t.kind === 'potion') {
      ctx.fillStyle = '#4fd18b'; ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(cx, cy + T * 0.12, T * 0.17, 0, 7); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#d7dbe8';
      ctx.fillRect(cx - T * 0.05, cy - T * 0.14, T * 0.1, T * 0.12); ctx.strokeRect(cx - T * 0.05, cy - T * 0.14, T * 0.1, T * 0.12);
      pill('+' + fmt(t.v), cx, cy - T * 0.3, Math.max(12, T * 0.19), '#173a2a', '#7dffb4');
    } else if (t.kind === 'relic') {
      ctx.fillStyle = '#ffd166'; ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)'; ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5 + Math.sin(time * 2) * 0.08, rr = T * (i % 2 ? 0.1 : 0.22);
        ctx.lineTo(cx + Math.cos(a) * rr, cy + T * 0.1 + Math.sin(a) * rr);
      }
      ctx.closePath(); ctx.fill(); ctx.stroke();
      pill('×' + t.v, cx, cy - T * 0.3, Math.max(12, T * 0.19), '#3a2c14', '#ffd166');
    } else {
      ctx.fillStyle = '#aab0c8'; ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)'; ctx.lineWidth = 2;
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.moveTo(cx + i * T * 0.2 - T * 0.1, cy + T * 0.32); ctx.lineTo(cx + i * T * 0.2, cy - T * 0.02); ctx.lineTo(cx + i * T * 0.2 + T * 0.1, cy + T * 0.32);
        ctx.closePath(); ctx.fill(); ctx.stroke();
      }
      pill('−' + fmt(t.v), cx, cy - T * 0.3, Math.max(12, T * 0.19), '#3a1719', '#ff8a80');
    }
  }

  function glide(key, tx, ty, dt) {
    let p = shown.get(key);
    if (!p) { p = { x: tx, y: ty }; shown.set(key, p); }
    const k = Math.min(1, dt * 20);
    p.x += (tx - p.x) * k;
    p.y += (ty - p.y) * k;
    return p;
  }

  function drawBoard(dt, time) {
    const st = run.st, g = geom(), T = g.T;
    ctx.save();
    if (shake > 0) ctx.translate(rnd(-shake, shake), rnd(-shake, shake));
    for (let y = 0; y < st.rows; y++) {
      for (let x = 0; x < st.cols; x++) {
        const px = g.ox + x * T, py = g.oy + y * T;
        if (st.wall[y][x]) {
          ctx.fillStyle = '#3d4468'; roundRect(px + 2, py + 2, T - 4, T - 4, 8); ctx.fill();
          ctx.fillStyle = '#4c5480'; roundRect(px + 2, py + 2, T - 4, T * 0.62, 8); ctx.fill();
        } else {
          ctx.fillStyle = (x + y) % 2 ? '#232844' : '#272d4c';
          ctx.fillRect(px, py, T, T);
        }
      }
    }
    ctx.strokeStyle = '#3d4468'; ctx.lineWidth = 3;
    ctx.strokeRect(g.ox - 2, g.oy - 2, T * st.cols + 4, T * st.rows + 4);

    // where pacing enemies walk
    ctx.setLineDash([5, 7]); ctx.lineWidth = 3;
    for (const t of st.things) {
      if (!t.route) continue;
      const [ax, ay] = centre(g, t.route[0].x, t.route[0].y);
      const [bx, by] = centre(g, t.route[t.route.length - 1].x, t.route[t.route.length - 1].y);
      ctx.strokeStyle = st.power > t.v ? 'rgba(79, 209, 139, 0.35)' : 'rgba(255, 107, 107, 0.45)';
      ctx.beginPath(); ctx.moveTo(ax, ay + T * 0.3); ctx.lineTo(bx, by + T * 0.3); ctx.stroke();
    }
    ctx.setLineDash([]);

    // Your tile glows gold, so you can always find yourself at a glance.
    const hp = glide('hero', st.x, st.y, dt);
    const [hx, hy] = centre(g, hp.x, hp.y);
    if (st.hearts > 0) {
      const pulse = 0.5 + 0.5 * Math.sin(time * 5);
      ctx.fillStyle = `rgba(255, 209, 102, ${0.2 + pulse * 0.12})`;
      roundRect(hx - T / 2 + 2, hy - T / 2 + 2, T - 4, T - 4, 9); ctx.fill();
      ctx.strokeStyle = `rgba(255, 209, 102, ${0.75 + pulse * 0.25})`;
      ctx.lineWidth = 4; ctx.stroke();
      if (spot > 0) {               // rings close in on the hero when a stage starts
        for (const lag of [0, 0.35]) {
          const k = Math.max(0, Math.min(1, (spot - lag) / 1.25));
          if (k <= 0) continue;
          ctx.strokeStyle = `rgba(255, 209, 102, ${1 - k})`;
          ctx.lineWidth = 5;
          ctx.beginPath(); ctx.arc(hx, hy, T * (0.55 + k * 2.6), 0, 7); ctx.stroke();
        }
      }
    }
    for (const t of st.things) {
      const p = glide(t.id, t.x, t.y, dt);
      const [cx, cy] = centre(g, p.x, p.y);
      drawThing(t, cx, cy, T, time);
    }
    if (st.hearts > 0) {
      drawHero(hx, hy, T);
      pill(fmt(st.power), hx, hy - T * 0.35, Math.max(15, T * 0.25), '#ffffff', '#0b3d7a');
      pill('YOU', hx, hy + T * 0.4, Math.max(10, T * 0.14), '#ffd166', '#241a05');
    }
    for (const p of fx) { ctx.globalAlpha = Math.max(0, Math.min(1, p.life * 3)); ctx.fillStyle = p.color; ctx.fillRect(p.x, p.y, p.size, p.size); }
    for (const t of texts) { ctx.globalAlpha = Math.max(0, Math.min(1, (t.life / t.max) * 2)); label(t.text, t.x, t.y, t.size, t.color, 'center', 800); }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function drawHud() {
    const st = run.st;
    ctx.fillStyle = '#10142a';
    ctx.fillRect(0, 0, W, HUD);
    label('STAGE ' + run.stage, 18, HUD / 2, 17, '#ffb84d', 'left');
    for (let i = 0; i < Math.max(3, st.hearts); i++) label('♥', 122 + i * 22, HUD / 2 + 1, 22, i < st.hearts ? '#ff6b6b' : '#3a3f5c');
    label('POWER', W / 2 - 8, HUD / 2, 14, '#9aa0bf', 'right');
    label(fmt(st.power), W / 2 + 2, HUD / 2 + 1, 26, '#fff', 'left', 800);
    label('BEST STAGE ' + best, W - 18, HUD / 2, 15, '#9aa0bf', 'right');
    if (mode === 'play') {
      if (stuck) {
        ctx.fillStyle = '#ffb84d';
        roundRect(W / 2 - 250, H - 32, 500, 26, 13); ctx.fill();
        label('No way to win from here. Press R to try this stage again.', W / 2, H - 18, 15, '#241a05');
      } else {
        label('Arrows / WASD move   ·   Space wait   ·   R restart stage', W / 2, H - 16, 13, '#6f7699', 'center', 500);
      }
    }
  }

  function overlay(title, lines, tint = 'rgba(8, 12, 24, 0.82)') {
    ctx.fillStyle = tint;
    ctx.fillRect(0, 0, W, H);
    label(title, W / 2, 230, 44, '#fff', 'center', 800);
    lines.forEach((l, i) => label(l[0], W / 2, 292 + i * 30, l[2] || 17, l[1] || '#c9cde6', 'center', l[3] || 500));
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    shake = Math.max(0, shake - dt * 36);
    spot = Math.max(0, spot - dt);
    flash = Math.max(0, flash - dt);
    for (const p of fx) { p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; }
    for (const t of texts) { t.y -= 38 * dt; t.life -= dt; }
    fx = fx.filter(p => p.life > 0);
    texts = texts.filter(t => t.life > 0);

    ctx.fillStyle = '#151930';
    ctx.fillRect(0, 0, W, H);
    if (run) { drawBoard(dt, now / 1000); drawHud(); }

    if (mode === 'title') {
      overlay('TINY HERO', [
        ['You start weak. Walk into an enemy to fight it.'],
        ['You only win against a smaller number, and then it becomes yours.'],
        ['You are the blue knight on the glowing gold tile.'],
        ['Green number: you win.   Red number: it costs you a heart.'],
        ['Potions add power, the star doubles it, spikes take some away.'],
        ['Beat every enemy to clear the stage.'],
        [''],
        [run ? `Press Space to continue at stage ${run.stage + (run.st.cleared ? 1 : 0)}` : 'Press Space to start', '#ffb84d', 20, 700],
      ]);
    } else if (mode === 'clear') {
      clearT -= dt;
      overlay('STAGE CLEAR', [
        [`Power ${fmt(run.st.power)} in ${run.st.steps} steps`, '#fff', 22, 700],
        [bonusHeart ? '+1 ♥ for clearing three stages' : '', '#ff6b6b', 18, 700],
        [''],
        ['Next stage…', '#ffb84d', 18, 700],
      ], 'rgba(8, 24, 18, 0.8)');
      if (clearT <= 0) startStage(run.stage + 1, run.st.hearts);
    } else if (mode === 'over') {
      overlay('OUT OF HEARTS', [
        [`You reached stage ${run.stage}`, '#fff', 22, 700],
        [`Best stage ${best}`, '#9aa0bf', 18, 700],
        [''],
        ['Press Space to start over', '#ffb84d', 20, 700],
      ], 'rgba(40, 8, 12, 0.82)');
    }
    requestAnimationFrame(frame);
  }

  // ---------- input and sizing ----------
  const MOVES = {
    ArrowLeft: [-1, 0], a: [-1, 0], ArrowRight: [1, 0], d: [1, 0],
    ArrowUp: [0, -1], w: [0, -1], ArrowDown: [0, 1], s: [0, 1],
  };
  let lastMove = 0;
  addEventListener('keydown', e => {
    if (e.target instanceof HTMLSelectElement || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (MOVES[k] || k === ' ') e.preventDefault();
    if (k === ' ' || k === 'Enter') {
      if (e.repeat) return;
      if (mode === 'title') {
        if (!run) startStage(1, 3);
        else if (run.st.cleared) startStage(run.stage + 1, run.st.hearts);
        else mode = 'play';
      }
      else if (mode === 'over') startStage(1, 3);
      else if (mode === 'clear') clearT = 0;
      else act(0, 0);
      return;
    }
    if (k === 'r' && mode === 'play' && !e.repeat) { restartStage(); return; }
    if (MOVES[k] && mode === 'play') {
      const now = performance.now();
      if (e.repeat && now - lastMove < 95) return;
      lastMove = now;
      act(...MOVES[k]);
    }
  });

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
  addEventListener('resize', fit);

  // Resume a saved run if there is one.
  const saved = store.get(RUN_KEY, null);
  if (saved && saved.st && Array.isArray(saved.st.things) && saved.st.hearts > 0) {
    run = saved;
    run.tiers = run.tiers || tiersFor(JSON.parse(run.initial).things);
    stuck = HeroCore.isStuck(run.st);
  }

  fit();
  requestAnimationFrame(frame);

  window.TinyHero = { run: () => run, mode: () => mode, act, start: () => startStage(1, 3) };
})();
