// Run with: node tests/hero.test.js
'use strict';
const assert = require('assert');
const Core = require('../hero/core.js');

let seed = 2024;
const rng = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

// A careful bot: walks to the nearest thing it can safely take, never steps on
// spikes or onto the path of a pacing enemy that is stronger than it.
function plan(st, lastResort) {
  const key = (x, y) => x + ',' + y;
  const goal = new Set(), danger = new Set();
  for (const t of st.things) {
    const k = key(t.x, t.y);
    if (t.kind === 'potion' || (t.kind === 'relic' && lastResort)) goal.add(k);
    else if (t.kind === 'enemy' && t.v < st.power) goal.add(k);
    else danger.add(k);
    if (t.kind === 'enemy' && t.route && t.v >= st.power) for (const c of t.route) danger.add(key(c.x, c.y));
  }
  const seen = new Set([key(st.x, st.y)]);
  const queue = [{ x: st.x, y: st.y, first: null }];
  for (let i = 0; i < queue.length; i++) {
    const c = queue[i];
    for (const [dx, dy] of Core.DIRS) {
      const nx = c.x + dx, ny = c.y + dy, k = key(nx, ny);
      if (nx < 0 || ny < 0 || nx >= st.cols || ny >= st.rows || st.wall[ny][nx] || seen.has(k) || danger.has(k)) continue;
      const first = c.first || [dx, dy];
      if (goal.has(k)) return first;
      seen.add(k);
      queue.push({ x: nx, y: ny, first });
    }
  }
  // Save the x2 relic until nothing else is left to do.
  return lastResort ? [0, 0] : plan(st, true);
}

let levels = 0, maxPower = 0, patrols = 0, spikes = 0;
for (let stage = 1; stage <= 16; stage++) {
  for (let n = 0; n < 40; n++) {
    const level = Core.generate(stage, rng);
    assert(Core.solve(level), 'generated levels are solvable');
    const cells = new Set(level.things.map(t => t.x + ',' + t.y));
    assert.strictEqual(cells.size, level.things.length, 'no two things share a tile');
    assert(!cells.has(level.start.x + ',' + level.start.y), 'nothing sits on the start tile');
    assert.strictEqual(level.things.filter(t => t.boss).length, 1, 'exactly one boss');
    patrols += level.things.filter(t => t.route).length;
    spikes += level.things.filter(t => t.kind === 'spike').length;

    const st = Core.newState(level, 3);
    let guard = 0;
    // Standing still now and then keeps the bot from dancing in step with a pacing enemy forever.
    while (!st.cleared && st.hearts > 0 && guard++ < 4000) Core.move(st, ...(guard % 5 === 4 ? [0, 0] : plan(st)));
    assert(st.cleared, `bot should clear stage ${stage} (stuck with power ${st.power}, ${st.things.filter(t => t.kind === 'enemy').length} enemies left)`);
    assert.strictEqual(st.hearts, 3, `a careful player loses no hearts on stage ${stage}`);
    assert(!Core.isStuck(Core.newState(level, 3)), 'a fresh level is never stuck');
    maxPower = Math.max(maxPower, st.power);
    levels++;
  }
}

// Rules spot checks on a hand-made room.
const room = { stage: 1, cols: 4, rows: 1, wall: [[0, 0, 0, 0]], start: { x: 0, y: 0 }, startPower: 3,
  things: [{ id: 1, kind: 'enemy', x: 1, y: 0, v: 3 }, { id: 2, kind: 'enemy', x: 3, y: 0, v: 2 }] };
let st = Core.newState(room, 3);
let ev = Core.move(st, 1, 0);
assert.strictEqual(ev[0].type, 'hurt', 'equal power does not win');
assert.deepStrictEqual([st.x, st.hearts, st.power], [0, 2, 3]);
assert.strictEqual(Core.move(st, -1, 0)[0].type, 'blocked');
room.things[0].v = 2;
st = Core.newState(room, 3);
ev = Core.move(st, 1, 0);
assert.strictEqual(ev[0].type, 'beat');
assert.deepStrictEqual([st.x, st.power, st.cleared], [1, 5, false]);
Core.move(st, 1, 0); Core.move(st, 1, 0);
assert.deepStrictEqual([st.x, st.power, st.cleared], [3, 7, true]);

console.log(`hero: ${levels} levels cleared by the bot without losing a heart ` +
  `(${patrols} pacing enemies, ${spikes} spikes, biggest final power ${maxPower})`);
