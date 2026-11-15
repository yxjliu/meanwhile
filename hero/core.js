// Tiny Hero rules: level generation, moves and a solver. Pure logic, no DOM,
// so it runs in the browser and under Node for tests.
//
// The hero has a power number. Walking into an enemy with LESS power beats it
// and adds its power to yours; walking into anything else costs a heart.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HeroCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const MAX_HEARTS = 5;

  function build(stage, rng, simple) {
    const rint = (a, b) => a + Math.floor(rng() * (b - a + 1));
    const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
    const cols = Math.min(11, 6 + Math.floor(stage / 2));
    const rows = Math.min(8, 5 + Math.floor((stage + 1) / 3));
    const wall = Array.from({ length: rows }, () => new Array(cols).fill(0));
    const inside = (x, y) => x >= 0 && y >= 0 && x < cols && y < rows;

    const connected = () => {
      let first = null, total = 0;
      for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) if (!wall[y][x]) { total++; first = first || [x, y]; }
      if (!first) return false;
      const seen = new Set([first[0] + ',' + first[1]]);
      const queue = [first];
      while (queue.length) {
        const [x, y] = queue.pop();
        for (const [dx, dy] of DIRS) {
          const nx = x + dx, ny = y + dy, k = nx + ',' + ny;
          if (inside(nx, ny) && !wall[ny][nx] && !seen.has(k)) { seen.add(k); queue.push([nx, ny]); }
        }
      }
      return seen.size === total;
    };
    // Scatter walls, never cutting the floor in two.
    const wantWalls = simple ? 0 : Math.floor(cols * rows * (0.17 + rng() * 0.08));
    for (let placed = 0, tries = 0; placed < wantWalls && tries < 500; tries++) {
      const x = rint(0, cols - 1), y = rint(0, rows - 1);
      if (wall[y][x]) continue;
      wall[y][x] = 1;
      if (connected()) placed++; else wall[y][x] = 0;
    }

    const floor = [];
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) if (!wall[y][x]) floor.push({ x, y });
    shuffle(floor);
    const start = floor.pop();

    let nEnemy = Math.min(4 + stage, 15);
    const nPotion = stage >= 3 ? 2 : 1;
    const nRelic = stage >= 2 ? 1 : 0;
    const nSpike = simple || stage < 2 ? 0 : Math.min(1 + Math.floor(stage / 3), 4);
    nEnemy = Math.min(nEnemy, floor.length - nPotion - nRelic - nSpike - 2);
    if (nEnemy < 3) return null;

    // Distance from the start, ignoring everything but walls.
    const dist = Array.from({ length: rows }, () => new Array(cols).fill(-1));
    dist[start.y][start.x] = 0;
    for (let q = [start], i = 0; i < q.length; i++) {
      for (const [dx, dy] of DIRS) {
        const nx = q[i].x + dx, ny = q[i].y + dy;
        if (inside(nx, ny) && !wall[ny][nx] && dist[ny][nx] < 0) { dist[ny][nx] = dist[q[i].y][q[i].x] + 1; q.push({ x: nx, y: ny }); }
      }
    }

    let id = 0;
    const things = [];
    const put = kind => { const c = floor.pop(); const t = { id: ++id, kind, x: c.x, y: c.y, v: 0 }; things.push(t); return t; };
    for (let i = 0; i < nEnemy; i++) put('enemy');
    for (let i = 0; i < nPotion; i++) put('potion');
    for (let i = 0; i < nRelic; i++) put('relic');

    // Hand out numbers along a rough near-to-far order so a winning order exists.
    const startPower = stage === 1 ? 2 : rint(2, 4);
    let p = startPower, beaten = 0;
    const order = things.map(t => ({ t, k: dist[t.y][t.x] + rng() * 5 })).sort((a, b) => a.k - b.k);
    for (const { t } of order) {
      if (t.kind === 'enemy') {
        const lo = Math.max(1, Math.ceil(p * (beaten < 6 ? 0.3 : 0.15)));
        const hi = Math.max(lo, beaten < 6 ? p - 1 : Math.floor(p * 0.6));
        t.v = rint(lo, Math.min(hi, p - 1));
        p += t.v;
        beaten++;
      } else if (t.kind === 'potion') {
        t.v = Math.max(1, Math.round(p * (0.2 + rng() * 0.25)));
        p += t.v;
      } else {
        t.v = 2;
        p *= 2;
      }
    }
    const enemies = things.filter(t => t.kind === 'enemy');
    enemies.reduce((a, b) => (b.v > a.v ? b : a)).boss = true;

    const mid = Math.sqrt(startPower * p);
    for (let i = 0; i < nSpike; i++) put('spike').v = Math.max(2, Math.round(mid * (0.3 + rng() * 0.5)));

    // Some enemies pace back and forth along a straight stretch of empty floor.
    const nPatrol = simple || stage < 3 ? 0 : Math.min(1 + Math.floor((stage - 3) / 2), 3);
    const taken = new Set(things.map(t => t.x + ',' + t.y));
    taken.add(start.x + ',' + start.y);
    let made = 0;
    for (const e of shuffle(enemies.filter(t => !t.boss))) {
      if (made >= nPatrol) break;
      for (const [dx, dy] of shuffle([[1, 0], [0, 1]])) {
        const free = (x, y) => inside(x, y) && !wall[y][x] && !taken.has(x + ',' + y);
        const route = [{ x: e.x, y: e.y }];
        let ahead = 1, behind = 1;
        while (route.length < 5 && free(e.x + dx * ahead, e.y + dy * ahead)) { route.push({ x: e.x + dx * ahead, y: e.y + dy * ahead }); ahead++; }
        while (route.length < 5 && free(e.x - dx * behind, e.y - dy * behind)) { route.unshift({ x: e.x - dx * behind, y: e.y - dy * behind }); behind++; }
        if (route.length < 3) continue;
        e.route = route;
        e.ri = route.findIndex(c => c.x === e.x && c.y === e.y);
        e.dir = 1;
        route.forEach(c => taken.add(c.x + ',' + c.y));
        made++;
        break;
      }
    }
    return { stage, cols, rows, wall, start, startPower, things };
  }

  /**
   * Can this position still be cleared by a careful player, one who never
   * walks onto the path of a pacing enemy that is still alive?
   *   lateRelic: save the x2 relic until nothing else can be done (best play).
   *              When false, grab it the moment it can be reached (careless play).
   *   useSpikes: allow paying a spike's toll when there is no other way on.
   */
  function canClear(st, lateRelic, useSpikes) {
    const { cols, rows, wall } = st;
    const start = { x: st.x, y: st.y };
    let p = st.power;
    const alive = st.things.filter(t => t.kind === 'enemy');
    const items = st.things.filter(t => t.kind === 'potion' || t.kind === 'relic');
    const spikes = st.things.filter(t => t.kind === 'spike');
    const cellsOf = e => (e.route ? e.route : [{ x: e.x, y: e.y }]);
    for (;;) {
      const blocked = new Set(spikes.map(t => t.x + ',' + t.y));
      for (const e of alive) for (const c of cellsOf(e)) blocked.add(c.x + ',' + c.y);
      const seen = new Set([start.x + ',' + start.y]);
      const queue = [start];
      while (queue.length) {
        const c = queue.pop();
        for (const [dx, dy] of DIRS) {
          const nx = c.x + dx, ny = c.y + dy, k = nx + ',' + ny;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || wall[ny][nx] || seen.has(k) || blocked.has(k)) continue;
          seen.add(k);
          queue.push({ x: nx, y: ny });
        }
      }
      const near = c => DIRS.some(([dx, dy]) => seen.has((c.x + dx) + ',' + (c.y + dy)));
      let got = false;
      for (let i = items.length - 1; i >= 0; i--) {
        const it = items[i];
        if (!seen.has(it.x + ',' + it.y) || (it.kind === 'relic' && lateRelic)) continue;
        p = it.kind === 'potion' ? p + it.v : p * it.v;
        items.splice(i, 1);
        got = true;
      }
      const target = alive.filter(e => e.v < p && cellsOf(e).some(near)).sort((a, b) => a.v - b.v)[0];
      if (target) { p += target.v; alive.splice(alive.indexOf(target), 1); continue; }
      if (got) continue;
      const relic = items.find(it => it.kind === 'relic' && seen.has(it.x + ',' + it.y));
      if (relic) { p *= relic.v; items.splice(items.indexOf(relic), 1); continue; }
      const toll = useSpikes && spikes.filter(t => t.v < p && near(t)).sort((a, b) => a.v - b.v)[0];
      if (toll) { p -= toll.v; spikes.splice(spikes.indexOf(toll), 1); continue; }
      return alive.length === 0;
    }
  }

  /** Levels must be clearable even if the player grabs the x2 relic as early as it shows up. */
  const solve = level => canClear(newState(level, 3), false, false);

  /** True when no line of play can clear the stage any more. */
  const isStuck = st => !st.cleared && st.hearts > 0 && !canClear(st, true, true);

  function generate(stage, rng) {
    rng = rng || Math.random;
    for (let i = 0; i < 300; i++) {
      const level = build(stage, rng, false);
      if (level && solve(level)) return level;
    }
    for (;;) {
      const level = build(stage, rng, true);
      if (level && solve(level)) return level;
    }
  }

  function newState(level, hearts) {
    return {
      stage: level.stage, cols: level.cols, rows: level.rows, wall: level.wall,
      x: level.start.x, y: level.start.y, power: level.startPower,
      hearts: hearts == null ? 3 : hearts, steps: 0, cleared: false,
      things: JSON.parse(JSON.stringify(level.things)),
    };
  }

  const thingAt = (st, x, y) => st.things.find(t => t.x === x && t.y === y);

  /** Move the hero one tile. Returns the list of things that happened. */
  function move(st, dx, dy) {
    const ev = [];
    if (st.cleared || st.hearts <= 0) return ev;
    const nx = st.x + dx, ny = st.y + dy;
    const waiting = dx === 0 && dy === 0; // stand still for a turn
    if (nx < 0 || ny < 0 || nx >= st.cols || ny >= st.rows || st.wall[ny][nx]) { ev.push({ type: 'blocked' }); return ev; }

    const remove = t => st.things.splice(st.things.indexOf(t), 1);
    const beat = e => { st.power += e.v; remove(e); ev.push({ type: 'beat', x: e.x, y: e.y, gain: e.v, boss: !!e.boss }); };
    let hurtNow = false;
    const hurt = t => { st.hearts -= 1; hurtNow = true; ev.push({ type: 'hurt', x: t.x, y: t.y, kind: t.kind, v: t.v }); };

    const t = waiting ? null : thingAt(st, nx, ny);
    let step = true;
    if (t) {
      if (t.kind === 'enemy') { if (st.power > t.v) beat(t); else { hurt(t); step = false; } }
      else if (t.kind === 'potion') { st.power += t.v; remove(t); ev.push({ type: 'pickup', kind: 'potion', v: t.v, x: nx, y: ny }); }
      else if (t.kind === 'relic') { st.power *= t.v; remove(t); ev.push({ type: 'pickup', kind: 'relic', v: t.v, x: nx, y: ny }); }
      else if (st.power > t.v) { st.power -= t.v; remove(t); ev.push({ type: 'spike', v: t.v, x: nx, y: ny }); }
      else { hurt(t); step = false; }
    }
    if (step) { st.x = nx; st.y = ny; }
    st.steps += 1;

    // Pacing enemies take their step.
    for (const e of st.things.filter(q => q.route)) {
      if (st.hearts <= 0) break;
      if (!st.things.includes(e)) continue;
      let ni = e.ri + e.dir;
      if (ni < 0 || ni >= e.route.length) { e.dir = -e.dir; ni = e.ri + e.dir; }
      const c = e.route[ni];
      if (!c) continue;
      if (c.x === st.x && c.y === st.y) {
        if (st.power > e.v) beat(e);
        else { if (!hurtNow) hurt(e); e.dir = -e.dir; }
        continue;
      }
      if (thingAt(st, c.x, c.y)) { e.dir = -e.dir; continue; }
      e.ri = ni; e.x = c.x; e.y = c.y;
    }
    if (st.hearts > 0 && !st.things.some(q => q.kind === 'enemy')) st.cleared = true;
    return ev;
  }

  return { DIRS, MAX_HEARTS, generate, solve, canClear, isStuck, newState, move, thingAt };
});
