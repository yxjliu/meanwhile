// Marble Rain: drawing, sound, input and run flow. The physics live in core.js.
(() => {
  'use strict';
  const M = MarbleCore;
  const { W, H, R, DROP_Y, CUP_Y, CUP_W, GATE_H } = M;
  const BEST_KEY = 'mw.marble.best', MUTE_KEY = 'mw.marble.mute';
  const cvs = document.getElementById('game');
  const ctx = cvs.getContext('2d');
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
  };
  const rnd = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const fmt = n => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 10000 ? (n / 1000).toFixed(1) + 'K' : String(Math.round(n)));
  // A marble changes colour each time it splits.
  const COLORS = ['#e8eaf6', '#5ad1ff', '#7dffb4', '#ffd166', '#ff9f6b', '#ff7eb6', '#b98cff'];
  const GATE_LOOK = {
    2: ['rgba(90, 169, 255, 0.55)', '#5aa9ff'], 3: ['rgba(79, 209, 139, 0.55)', '#4fd18b'], 4: ['rgba(255, 209, 102, 0.6)', '#ffd166'],
    half: ['rgba(255, 107, 107, 0.5)', '#ff6b6b'], kill: ['rgba(150, 30, 40, 0.75)', '#ff6b6b'],
  };

  let best = store.get(BEST_KEY, { level: 0, bank: 0 });
  let muted = store.get(MUTE_KEY, false);
  let mode = 'title';            // title | play | paused | result | over
  let run = null;
  let fx = [];
  let acc = 0, resultT = 0, intro = 0, combo = 0, pauseWhy = '';
  const keys = new Set();

  // ---------- sound ----------
  let audio = null;
  const lastAt = {};
  function wake() {
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === 'suspended') audio.resume();
    } catch { /* no audio */ }
  }
  function blip(kind, freq, dur, vol, type) {
    if (muted || !audio || audio.state !== 'running') return;
    const now = audio.currentTime;
    if (now - (lastAt[kind] || 0) < 0.035) return;
    lastAt[kind] = now;
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, now);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(vol, now + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    o.connect(g).connect(audio.destination);
    o.start(now);
    o.stop(now + dur + 0.02);
  }

  // ---------- run flow ----------
  function startRun() {
    run = { n: 1, lives: 3, bank: 0 };
    startLevel(true);
  }
  function startLevel(fresh) {
    if (fresh) run.level = M.generate(run.n);
    run.world = M.newWorld(run.level);
    run.ammo = run.level.ammo;
    run.cup = W / 2;
    run.phase = rnd(0, 6.28);
    run.pour = 0;
    run.shown = 0;
    run.result = null;
    fx = [];
    acc = 0; combo = 0; intro = 2;
    keys.delete(' ');
    mode = 'play';
  }
  const dropX = () => W / 2 + 190 * Math.sin(run.phase);

  function finishLevel() {
    const got = run.world.collected, pass = got >= run.level.target;
    run.result = { pass, got };
    if (pass) {
      run.bank += got;
      if (run.n > best.level || run.bank > best.bank) {
        best = { level: Math.max(best.level, run.n), bank: Math.max(best.bank, run.bank) };
        store.set(BEST_KEY, best);
      }
      blip('win', 660, 0.5, 0.2, 'triangle');
      mode = 'result';
      resultT = 2.4;
    } else {
      run.lives -= 1;
      blip('lose', 160, 0.5, 0.2, 'sawtooth');
      mode = run.lives > 0 ? 'result' : 'over';
      resultT = 2.4;
    }
  }
  function afterResult() {
    if (run.result.pass) { run.n += 1; startLevel(true); } else startLevel(false);
  }

  function burst(x, y, color, n, speed) {
    for (let i = 0; i < n; i++) {
      const a = rnd(0, Math.PI * 2), v = rnd(speed * 0.3, speed);
      fx.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rnd(0.2, 0.45), color, size: rnd(2, 4) });
    }
  }

  function update(dt) {
    const w = run.world;
    intro = Math.max(0, intro - dt);
    const dir = (keys.has('ArrowRight') || keys.has('d') ? 1 : 0) - (keys.has('ArrowLeft') || keys.has('a') ? 1 : 0);
    run.cup = clamp(run.cup + dir * 460 * dt, CUP_W / 2, W - CUP_W / 2);

    if (keys.has(' ') && run.ammo > 0) {
      run.pour += dt;
      while (run.pour >= 1 / 16 && run.ammo > 0) {
        run.pour -= 1 / 16;
        run.ammo -= 1;
        M.addBall(w, dropX() + rnd(-5, 5), DROP_Y, rnd(-22, 22), 60);
        blip('drop', 300, 0.05, 0.05);
      }
    } else {
      run.pour = 0;
      run.phase += run.level.dropSpeed * dt;   // the dropper only slides while it is not pouring
    }

    acc = Math.min(acc + dt, 0.06);
    while (acc >= 1 / 120) { M.step(w, 1 / 120, run.cup); acc -= 1 / 120; }

    combo = Math.max(0, combo - dt * 6);
    for (const e of w.events) {
      if (e.type === 'split') {
        if (fx.length < 500) burst(e.x, e.y, '#fff', 3, 90);
        blip('split', 520 + e.k * 90 + rnd(-30, 30), 0.09, 0.07, 'triangle');
      } else if (e.type === 'catch') {
        combo = Math.min(18, combo + 1);
        if (fx.length < 500) fx.push({ x: e.x, y: CUP_Y - 4, vx: rnd(-40, 40), vy: rnd(-150, -70), life: 0.35, color: '#ffd166', size: 3 });
        blip('catch', 440 + combo * 38, 0.07, 0.06);
      } else if (e.type === 'bump') {
        blip('bump', 210 + rnd(-20, 20), 0.08, 0.08, 'square');
      } else if (e.type === 'pop') {
        if (fx.length < 500) burst(e.x, e.y, '#ff6b6b', 4, 80);
      }
    }
    w.events.length = 0;
    run.shown += (w.collected - run.shown) * Math.min(1, dt * 12);

    if (run.ammo === 0 && w.balls.length === 0) finishLevel();
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

  function drawBoard() {
    const w = run.world, level = run.level;
    // ramps
    ctx.lineCap = 'round';
    for (const s of level.segs) {
      ctx.strokeStyle = '#5b6592'; ctx.lineWidth = 8;
      ctx.beginPath(); ctx.moveTo(s.x1, s.y1); ctx.lineTo(s.x2, s.y2); ctx.stroke();
      ctx.strokeStyle = '#8791c2'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(s.x1, s.y1 - 2); ctx.lineTo(s.x2, s.y2 - 2); ctx.stroke();
    }
    // pegs and bumpers
    for (const p of w.pegs) {
      if (p.bump) {
        ctx.fillStyle = p.flash > 0 ? '#fff' : '#ff7eb6';
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r + (p.flash > 0 ? 3 : 0), 0, 7); ctx.fill();
        ctx.fillStyle = '#a8346b';
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 0.5, 0, 7); ctx.fill();
      } else {
        ctx.fillStyle = '#aeb6d8';
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fill();
      }
    }
    // gates
    for (const g of w.gates) {
      const [fill, edge] = GATE_LOOK[g.kind === 'mul' ? g.k : g.kind];
      ctx.fillStyle = g.flash > 0 ? 'rgba(255, 255, 255, 0.85)' : fill;
      roundRect(g.x, g.y - GATE_H / 2, g.w, GATE_H, 6); ctx.fill();
      ctx.strokeStyle = edge; ctx.lineWidth = 2; ctx.stroke();
      label(g.kind === 'mul' ? '×' + g.k : g.kind === 'half' ? '÷2' : '✕', g.x + g.w / 2, g.y + 1, 16, g.flash > 0 ? '#10131f' : '#fff', 'center', 800);
    }
    // marbles
    for (const b of w.balls) {
      ctx.fillStyle = COLORS[Math.min(b.gen, COLORS.length - 1)];
      ctx.beginPath(); ctx.arc(b.x, b.y, b.value > 1 ? R + 2 : R, 0, 7); ctx.fill();
      if (b.value > 1) { ctx.strokeStyle = '#ffd166'; ctx.lineWidth = 2; ctx.stroke(); }
    }
    // cup
    const cx = run.cup, half = CUP_W / 2;
    ctx.fillStyle = 'rgba(255, 209, 102, 0.16)';
    ctx.beginPath(); ctx.moveTo(cx - half, CUP_Y - 2); ctx.lineTo(cx - half + 12, H - 8); ctx.lineTo(cx + half - 12, H - 8); ctx.lineTo(cx + half, CUP_Y - 2); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#ffd166'; ctx.lineWidth = 5; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(cx - half, CUP_Y - 2); ctx.lineTo(cx - half + 12, H - 8); ctx.lineTo(cx + half - 12, H - 8); ctx.lineTo(cx + half, CUP_Y - 2); ctx.stroke();
    label(fmt(run.shown), cx, CUP_Y + 28, 20, '#ffd166', 'center', 800);

    // dropper
    const dx = dropX(), pouring = keys.has(' ') && run.ammo > 0 && mode === 'play';
    ctx.strokeStyle = '#2c3252'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(20, 52); ctx.lineTo(W - 20, 52); ctx.stroke();
    ctx.setLineDash([3, 8]); ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(dx, DROP_Y + 6); ctx.lineTo(dx, DROP_Y + 78); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = pouring ? '#ffd166' : '#ffb84d';
    roundRect(dx - 34, 40, 68, 30, 9); ctx.fill();
    ctx.beginPath(); ctx.moveTo(dx - 12, 70); ctx.lineTo(dx + 12, 70); ctx.lineTo(dx + 7, DROP_Y); ctx.lineTo(dx - 7, DROP_Y); ctx.closePath(); ctx.fill();
    label(String(run.ammo), dx, 56, 17, '#241a05', 'center', 800);

    for (const p of fx) { ctx.globalAlpha = clamp(p.life * 3.5, 0, 1); ctx.fillStyle = p.color; ctx.fillRect(p.x, p.y, p.size, p.size); }
    ctx.globalAlpha = 1;
  }

  function drawHud() {
    const w = run.world, target = run.level.target, got = Math.round(run.shown);
    ctx.fillStyle = '#0c1020';
    ctx.fillRect(0, 0, W, 34);
    label('LEVEL ' + run.n, 12, 17, 14, '#ffb84d', 'left');
    for (let i = 0; i < 3; i++) { ctx.fillStyle = i < run.lives ? '#ff6b6b' : '#30354f'; ctx.beginPath(); ctx.arc(92 + i * 15, 17, 5, 0, 7); ctx.fill(); }
    const bx = 150, bw = 190, frac = clamp(w.collected / target, 0, 1);
    ctx.fillStyle = '#20253d'; roundRect(bx, 9, bw, 16, 8); ctx.fill();
    ctx.fillStyle = frac >= 1 ? '#4fd18b' : '#5aa9ff';
    if (frac > 0) { roundRect(bx, 9, Math.max(16, bw * frac), 16, 8); ctx.fill(); }
    label(`${fmt(got)} / ${fmt(target)}`, bx + bw / 2, 18, 12, '#fff', 'center', 800);
    label('BANK ' + fmt(run.bank), W - 12, 17, 14, '#9aa0bf', 'right');
    if (muted) label('MUTED', W - 12, H - 12, 11, '#6f7699', 'right');
    if (mode === 'play' && intro > 0) {
      ctx.globalAlpha = Math.min(1, intro);
      label('LEVEL ' + run.n, W / 2, 330, 40, '#fff', 'center', 800);
      label(`Catch ${fmt(target)} marbles`, W / 2, 372, 20, '#ffd166');
      ctx.globalAlpha = 1;
    }
  }

  function overlay(title, lines, tint = 'rgba(8, 12, 24, 0.8)') {
    ctx.fillStyle = tint;
    ctx.fillRect(0, 0, W, H);
    label(title, W / 2, 290, 40, '#fff', 'center', 800);
    lines.forEach((l, i) => label(l[0], W / 2, 348 + i * 29, l[2] || 16, l[1] || '#c9cde6', 'center', l[3] || 500));
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (mode === 'play') update(dt);
    for (const p of fx) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 300 * dt; p.life -= dt; }
    fx = fx.filter(p => p.life > 0);

    ctx.fillStyle = '#101426';
    ctx.fillRect(0, 0, W, H);
    if (run) { drawBoard(); drawHud(); }

    if (mode === 'title') {
      overlay('MARBLE RAIN', [
        ['The dropper slides along the top by itself.'],
        ['Hold Space to pour marbles. Let go to move on and pour elsewhere.'],
        ['Every ×2, ×3 or ×4 gate a marble falls through splits it.'],
        ['Red gates destroy marbles, so pour around them.'],
        ['← →  or  A D  move the cup. Catch enough to clear the level.'],
        [''],
        ['Press Space to start', '#ffb84d', 20, 700],
        ['M mutes the sound', '#6f7699', 13],
      ]);
    } else if (mode === 'paused') {
      overlay('PAUSED', [[pauseWhy || 'Take your time.', '#ffb84d', 18, 700], [''], ['Press Space to carry on']]);
    } else if (mode === 'result' || mode === 'over') {
      const r = run.result;
      if (mode === 'result') { resultT -= dt; if (resultT <= 0) afterResult(); }
      if (mode === 'result' && r.pass) {
        overlay('LEVEL CLEAR', [
          [`${fmt(r.got)} marbles caught`, '#fff', 22, 700],
          [`Bank ${fmt(run.bank)}`, '#ffd166', 18, 700],
          [''], ['Next level…', '#ffb84d', 18, 700],
        ], 'rgba(8, 24, 18, 0.8)');
      } else if (mode === 'result') {
        overlay('NOT ENOUGH', [
          [`${fmt(r.got)} of ${fmt(run.level.target)} caught`, '#fff', 22, 700],
          [`${run.lives} ${run.lives === 1 ? 'life' : 'lives'} left. Same board again.`, '#ff6b6b', 18, 700],
          [''], ['Try pouring from a different spot', '#c9cde6', 16],
        ], 'rgba(40, 8, 12, 0.8)');
      } else if (mode === 'over') {
        overlay('OUT OF LIVES', [
          [`Reached level ${run.n} with ${fmt(run.bank)} banked`, '#fff', 21, 700],
          [`Best: level ${best.level}, bank ${fmt(best.bank)}`, '#9aa0bf', 17, 700],
          [''], ['Press Space to start over', '#ffb84d', 20, 700],
        ], 'rgba(40, 8, 12, 0.82)');
      }
    }
    requestAnimationFrame(frame);
  }

  // ---------- input and sizing ----------
  function pause(why) {
    if (mode !== 'play') return;
    mode = 'paused';
    pauseWhy = why || '';
    keys.clear();
  }
  addEventListener('keydown', e => {
    if (e.target instanceof HTMLSelectElement || e.ctrlKey || e.metaKey || e.altKey) return;
    wake();
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' '].includes(k)) e.preventDefault();
    if (k === ' ' || k === 'Enter') {
      if (e.repeat) return;
      if (mode === 'title' || mode === 'over') { startRun(); return; }
      if (mode === 'paused') { mode = 'play'; last = performance.now(); return; }
      if (mode === 'result') { afterResult(); return; }
      if (k === ' ') keys.add(' ');
      return;
    }
    if (k === 'm' && !e.repeat) { muted = !muted; store.set(MUTE_KEY, muted); return; }
    if ((k === 'p' || k === 'Escape') && !e.repeat) {
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
  fit();
  requestAnimationFrame(frame);

  // Small handle for testing from the console.
  window.MarbleRain = { run: () => run, mode: () => mode, start: startRun, tick: update, keys };
})();
