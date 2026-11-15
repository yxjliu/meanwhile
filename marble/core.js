// Marble Rain physics and level generation. Pure logic, no DOM, so it runs in
// the browser and under Node for tests.
//
// Marbles fall from a dropper, bounce off pegs, bumpers and ramps, and split
// when they pass through a multiplier gate. Whatever lands in the cup counts.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MarbleCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const W = 480, H = 800;
  const R = 6;                 // marble radius
  const GRAVITY = 1100;
  const DROP_Y = 84;           // where marbles leave the dropper
  const CUP_Y = 744, CUP_W = 116;
  const GATE_H = 20;
  const MAX_BALLS = 650;       // beyond this, a split makes marbles worth more instead of adding more

  // ---------- level generation ----------
  function makeLevel(n, rng) {
    rng = rng || Math.random;
    const pick = a => a[Math.floor(rng() * a.length)];
    const level = { n, pegs: [], segs: [], gates: [], ammo: 24 + 3 * Math.min(n, 8), dropSpeed: 1.0 + 0.07 * Math.min(n, 12), target: 0 };
    const peg = (x, y, r, bump) => level.pegs.push({ x, y, r, bump: !!bump });
    const seg = (x1, y1, x2, y2) => level.segs.push({ x1, y1, x2, y2 });

    function gateBand(y) {
      const wide = n <= 2 && rng() < 0.5;
      const slots = wide ? [{ x: 44, w: 176 }, { x: 260, w: 176 }] : [{ x: 36, w: 112 }, { x: 184, w: 112 }, { x: 332, w: 112 }];
      const kinds = slots.map(() => {
        const roll = rng();
        if (n >= 5 && roll < 0.12) return { kind: 'kill', k: 0 };
        if (n >= 3 && roll < 0.3) return { kind: 'half', k: 0 };
        if (n >= 4 && roll > 0.93) return { kind: 'mul', k: 4 };
        return { kind: 'mul', k: roll > 0.68 ? 3 : 2 };
      });
      if (!kinds.some(k => k.kind === 'mul')) kinds[Math.floor(rng() * kinds.length)] = { kind: 'mul', k: 2 };
      const moving = n >= 2 && rng() < Math.min(0.75, 0.25 + n * 0.08);
      const amp = moving ? 30 : 0, speed = 0.9 + rng() * 0.9, phase = rng() * 6.28;
      slots.forEach((s, i) => level.gates.push({ id: level.gates.length, bx: s.x, x: s.x, y, w: s.w, kind: kinds[i].kind, k: kinds[i].k, amp, speed, phase, flash: 0 }));
    }
    const fillers = {
      pegs(y) {
        for (let i = 0; i < 8; i++) peg(40 + i * 57, y + 14, 6);
        for (let i = 0; i < 7; i++) peg(68.5 + i * 57, y + 58, 6);
      },
      bumpers(y) {
        const xs = pick([[110, 240, 370], [150, 330], [80, 240, 400]]);
        xs.forEach((x, i) => peg(x, y + 36 + (i % 2 ? 16 : -6), 20, true));
        peg(24, y + 70, 6); peg(456, y + 70, 6);
      },
      funnel(y) { seg(14, y + 8, 168, y + 66); seg(466, y + 8, 312, y + 66); },
      wedge(y) { seg(240, y + 6, 118, y + 62); seg(240, y + 6, 362, y + 62); peg(30, y + 40, 6); peg(450, y + 40, 6); },
      slide(y) {
        if (rng() < 0.5) { seg(14, y + 8, 290, y + 64); peg(400, y + 30, 6); }
        else { seg(466, y + 8, 190, y + 64); peg(80, y + 30, 6); }
      },
    };

    const bands = n >= 6 ? 6 : 5;
    const gap = n >= 6 ? 92 : 108;
    let lastFiller = '';
    for (let i = 0; i < bands; i++) {
      const y = 150 + i * gap;
      if (i % 2 === 0) { gateBand(y + 30); continue; }
      let name;
      do { name = pick(n === 1 ? ['pegs', 'pegs', 'bumpers'] : ['pegs', 'bumpers', 'funnel', 'wedge', 'slide']); } while (name === lastFiller);
      lastFiller = name;
      fillers[name](y);
    }
    return level;
  }

  // ---------- world ----------
  function newWorld(level, rng) {
    return {
      level, rng: rng || Math.random, t: 0, balls: [], events: [],
      gates: level.gates.map(g => ({ ...g })), pegs: level.pegs.map(p => ({ ...p, flash: 0 })),
      collected: 0, lost: 0,
    };
  }
  function addBall(world, x, y, vx, vy) {
    world.balls.push({ x, y, vx, vy, value: 1, used: 0, gen: 0, age: 0, still: 0, dead: false });
  }

  function bounce(b, nx, ny, rest, kick) {
    const vn = b.vx * nx + b.vy * ny;
    if (vn >= 0) return false;
    b.vx -= (1 + rest) * vn * nx;
    b.vy -= (1 + rest) * vn * ny;
    if (kick) {
      const out = b.vx * nx + b.vy * ny;
      if (out < kick) { b.vx += (kick - out) * nx; b.vy += (kick - out) * ny; }
    }
    return true;
  }

  /**
   * Advance the world by dt seconds. cupX is the centre of the cup, or null to
   * count every marble that reaches the bottom (used when estimating a level).
   * Things worth showing or hearing are appended to world.events.
   */
  function step(world, dt, cupX) {
    const { rng, gates, pegs } = world;
    const segs = world.level.segs;
    world.t += dt;
    for (const g of gates) {
      g.x = g.bx + g.amp * Math.sin(world.t * g.speed + g.phase);
      if (g.flash > 0) g.flash -= dt;
    }
    for (const p of pegs) if (p.flash > 0) p.flash -= dt;

    const born = [];
    let count = world.balls.length;
    for (const b of world.balls) {
      b.age += dt;
      b.vy += GRAVITY * dt;
      const py = b.y;
      b.x += b.vx * dt;
      b.y += b.vy * dt;

      if (b.x < R) { b.x = R; b.vx = Math.abs(b.vx) * 0.6; }
      else if (b.x > W - R) { b.x = W - R; b.vx = -Math.abs(b.vx) * 0.6; }

      for (const p of pegs) {
        const dx = b.x - p.x, dy = b.y - p.y, rr = R + p.r;
        if (dx > rr || dx < -rr || dy > rr || dy < -rr) continue;
        const d2 = dx * dx + dy * dy;
        if (d2 >= rr * rr) continue;
        const d = Math.sqrt(d2) || 0.01, nx = dx / d, ny = dy / d;
        b.x = p.x + nx * rr; b.y = p.y + ny * rr;
        if (bounce(b, nx, ny, p.bump ? 0.9 : 0.5, p.bump ? 300 : 0)) {
          b.vx += (rng() - 0.5) * 24;
          if (p.bump) { p.flash = 0.12; world.events.push({ type: 'bump', x: p.x, y: p.y }); }
        }
      }
      for (const s of segs) {
        const ex = s.x2 - s.x1, ey = s.y2 - s.y1;
        let t = ((b.x - s.x1) * ex + (b.y - s.y1) * ey) / (ex * ex + ey * ey);
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const dx = b.x - (s.x1 + ex * t), dy = b.y - (s.y1 + ey * t), rr = R + 3;
        const d2 = dx * dx + dy * dy;
        if (d2 >= rr * rr) continue;
        const d = Math.sqrt(d2) || 0.01, nx = dx / d, ny = dy / d;
        b.x += nx * (rr - d); b.y += ny * (rr - d);
        bounce(b, nx, ny, 0.3, 0);
      }

      // gates: each marble uses each gate once, on the way down
      for (const g of gates) {
        const bit = 1 << g.id;
        if (b.used & bit || py >= g.y || b.y < g.y || b.x < g.x || b.x > g.x + g.w) continue;
        b.used |= bit;
        g.flash = 0.1;
        if (g.kind === 'mul') {
          b.gen += 1;
          const each = b.value;
          for (let i = 1; i < g.k; i++) {
            if (count < MAX_BALLS) {
              count++;
              born.push({ ...b, value: each, vx: b.vx + (rng() - 0.5) * 190, vy: b.vy * (0.55 + rng() * 0.45) });
            } else {
              b.value += each;
            }
          }
          world.events.push({ type: 'split', x: b.x, y: g.y, k: g.k });
        } else if (g.kind === 'kill' || rng() < 0.5) {
          b.dead = true;
          world.lost += b.value;
          world.events.push({ type: 'pop', x: b.x, y: g.y });
          break;
        }
      }
      if (b.dead) continue;

      if (py < CUP_Y && b.y >= CUP_Y && (cupX == null || Math.abs(b.x - cupX) < CUP_W / 2)) {
        b.dead = true;
        world.collected += b.value;
        world.events.push({ type: 'catch', x: b.x, y: CUP_Y, value: b.value });
        continue;
      }
      if (b.y > H + 20 || b.age > 30) { b.dead = true; world.lost += b.value; continue; }

      // A marble that has come to rest on something gets a nudge.
      if (b.vx * b.vx + b.vy * b.vy < 900) {
        b.still += dt;
        if (b.still > 0.8) { b.vx += (rng() - 0.5) * 220; b.vy -= 90; b.still = 0; }
      } else {
        b.still = 0;
      }
    }
    if (born.length || world.balls.some(b => b.dead)) {
      world.balls = world.balls.filter(b => !b.dead);
      for (const b of born) world.balls.push(b);
    }
  }

  /** Marbles reaching the bottom per marble dropped, for a few dropper positions. */
  function survey(level, rng) {
    rng = rng || Math.random;
    const out = [];
    for (let x = 60; x <= 420; x += 60) {
      const world = newWorld(level, rng);
      world.t = rng() * 6;
      const drops = 8;
      let dropped = 0, next = 0;
      for (let i = 0; i < 1800 && (dropped < drops || world.balls.length); i++) {
        if (dropped < drops && i >= next) { addBall(world, x + (rng() - 0.5) * 10, DROP_Y, (rng() - 0.5) * 40, 60); dropped++; next = i + 14; }
        step(world, 1 / 90, null);
        world.events.length = 0;
      }
      out.push({ x, yield: world.collected / drops });
    }
    return out;
  }

  /** Build a level and set a target a decent player can reach. */
  function generate(n, rng) {
    rng = rng || Math.random;
    for (let tries = 0; ; tries++) {
      const level = makeLevel(n, rng);
      const yields = survey(level, rng).map(s => s.yield).sort((a, b) => b - a);
      const good = (yields[0] + yields[1]) / 2;
      if (good < 2 && tries < 20) continue; // a board that barely multiplies is no fun
      const raw = level.ammo * good * 0.22;
      const step5 = raw >= 200 ? 50 : raw >= 60 ? 10 : 5;
      level.target = Math.max(level.ammo, Math.round(raw / step5) * step5);
      return level;
    }
  }

  return { W, H, R, DROP_Y, CUP_Y, CUP_W, GATE_H, MAX_BALLS, makeLevel, generate, survey, newWorld, addBall, step };
});
