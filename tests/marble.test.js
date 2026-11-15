// Run with: node tests/marble.test.js
'use strict';
const assert = require('assert');
const M = require('../marble/core.js');

let seed = 777;
const rng = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

// A plain player: pours everything from the best-looking spot, then keeps the
// cup under the marbles that are closest to landing.
function play(level, skill) {
  const spots = M.survey(level, rng).sort((a, b) => b.yield - a.yield);
  const dropX = spots[skill === 'good' ? 0 : Math.min(2, spots.length - 1)].x;
  const world = M.newWorld(level, rng);
  let ammo = level.ammo, cup = M.W / 2, pour = 0, peak = 0;
  for (let i = 0; i < 120 * 60 && (ammo > 0 || world.balls.length); i++) {
    const dt = 1 / 120;
    pour += dt;
    if (ammo > 0 && pour >= 1 / 16) { pour = 0; ammo--; M.addBall(world, dropX + (rng() - 0.5) * 8, M.DROP_Y, (rng() - 0.5) * 40, 60); }
    const low = world.balls.filter(b => b.y > 500);
    if (low.length) {
      const aim = low.reduce((s, b) => s + b.x, 0) / low.length;
      cup += Math.max(-430 * dt, Math.min(430 * dt, aim - cup));
      cup = Math.max(M.CUP_W / 2, Math.min(M.W - M.CUP_W / 2, cup));
    }
    M.step(world, dt, cup);
    world.events.length = 0;
    peak = Math.max(peak, world.balls.length);
    for (const b of world.balls) assert(Number.isFinite(b.x) && Number.isFinite(b.y), 'marble positions stay finite');
  }
  assert.strictEqual(world.balls.length, 0, 'every marble ends up caught or lost');
  assert(peak <= M.MAX_BALLS, 'marble count stays under the cap');
  return { collected: world.collected, lost: world.lost, peak };
}

const rows = [];
let genMs = 0;
for (let n = 1; n <= 12; n++) {
  let passGood = 0, passOk = 0, sumRatio = 0, peak = 0, targets = [];
  const runs = 12;
  for (let i = 0; i < runs; i++) {
    const t0 = Date.now();
    const level = M.generate(n, rng);
    genMs = Math.max(genMs, Date.now() - t0);
    assert(level.target >= level.ammo, 'target is at least the marbles you start with');
    assert(level.gates.some(g => g.kind === 'mul'), 'every level has a multiplier');
    assert(level.gates.length <= 30, 'gate ids fit in the bitmask');
    const good = play(level, 'good'), ok = play(level, 'ok');
    if (good.collected >= level.target) passGood++;
    if (ok.collected >= level.target) passOk++;
    sumRatio += good.collected / level.target;
    peak = Math.max(peak, good.peak);
    targets.push(level.target);
  }
  rows.push(`  level ${String(n).padStart(2)}: good player passes ${passGood}/${runs}, average player ${passOk}/${runs}, ` +
    `collected/target ${(sumRatio / runs).toFixed(2)}, targets ${Math.min(...targets)}-${Math.max(...targets)}, most marbles at once ${peak}`);
}
console.log(rows.join('\n'));
console.log(`marble: all levels played to the end; slowest level build ${genMs} ms`);
