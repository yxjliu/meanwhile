// Run with: node tests/ddz.test.js
'use strict';
const assert = require('assert');
const DDZ = require('../ddz/engine.js');
const AI = require('../ddz/ai.js');

// Build cards from a compact string: "3 3 3 4" or "10 J Q K A", "x" = 小王, "X" = 大王.
const RANK = { J: 11, Q: 12, K: 13, A: 14, 2: 15, x: 16, X: 17 };
function hand(text) {
  const used = {};
  return text.trim().split(/\s+/).map(tok => {
    const r = RANK[tok] || Number(tok);
    if (r === 16) return 52;
    if (r === 17) return 53;
    used[r] = (used[r] || 0) + 1;
    assert(used[r] <= 4, 'too many of rank ' + tok);
    return (r - 3) * 4 + used[r] - 1;
  });
}
const type = text => { const a = DDZ.analyze(hand(text)); return a ? `${a.type}:${a.main}:${a.len}` : null; };

let passed = 0;
function test(name, fn) { fn(); passed++; }

test('hand types', () => {
  assert.strictEqual(type('5'), 'single:5:1');
  assert.strictEqual(type('X'), 'single:17:1');
  assert.strictEqual(type('9 9'), 'pair:9:1');
  assert.strictEqual(type('x X'), 'rocket:17:1');
  assert.strictEqual(type('9 10'), null);
  assert.strictEqual(type('x 2'), null);
  assert.strictEqual(type('7 7 7'), 'triple:7:1');
  assert.strictEqual(type('7 7 7 7'), 'bomb:7:1');
  assert.strictEqual(type('7 7 7 3'), 'triple1:7:1');
  assert.strictEqual(type('7 7 7 3 3'), 'triple2:7:1');
  assert.strictEqual(type('7 7 7 3 4'), null);
  assert.strictEqual(type('7 7 7 7 4'), null);
  assert.strictEqual(type('3 4 5 6 7'), 'straight:7:5');
  assert.strictEqual(type('10 J Q K A'), 'straight:14:5');
  assert.strictEqual(type('J Q K A 2'), null);
  assert.strictEqual(type('3 4 5 6'), null);
  assert.strictEqual(type('3 4 5 6 8'), null);
  assert.strictEqual(type('3 4 5 6 7 8 9 10 J Q K A'), 'straight:14:12');
  assert.strictEqual(type('3 3 4 4 5 5'), 'pairs:5:3');
  assert.strictEqual(type('3 3 4 4'), null);
  assert.strictEqual(type('K K A A 2 2'), null);
  assert.strictEqual(type('3 3 3 4 4 4'), 'plane:4:2');
  assert.strictEqual(type('3 3 3 4 4 4 7 9'), 'plane1:4:2');
  assert.strictEqual(type('3 3 3 4 4 4 7 7 9 9'), 'plane2:4:2');
  assert.strictEqual(type('3 3 3 4 4 4 7 7 9 10'), null);
  assert.strictEqual(type('3 3 3 4 4 4 5 5 5 6 7 8'), 'plane1:5:3');
  assert.strictEqual(type('A A A 2 2 2 5 6'), null);
  assert.strictEqual(type('8 8 8 8 3 5'), 'four2:8:1');
  assert.strictEqual(type('8 8 8 8 3 3 5 5'), 'four22:8:1');
  assert.strictEqual(type('8 8 8 8 3 3 5'), null);
});

test('beats', () => {
  const b = (x, y) => DDZ.beats(DDZ.analyze(hand(x)), DDZ.analyze(hand(y)));
  assert(b('6', '5'));
  assert(!b('5', '5'));
  assert(b('X', 'x'));
  assert(b('2', 'A'));
  assert(!b('6 6', '5'));
  assert(b('3 3 3 3', '2 2'));
  assert(b('4 4 4 4', '3 3 3 3'));
  assert(!b('3 3 3 3', '4 4 4 4'));
  assert(b('x X', '2 2 2 2'));
  assert(!b('2 2 2 2', 'x X'));
  assert(b('4 5 6 7 8', '3 4 5 6 7'));
  assert(!b('4 5 6 7 8 9', '3 4 5 6 7'));
  assert(b('8 8 8 3', '7 7 7 A'));
  assert(!b('8 8 8 3 3', '7 7 7 A'));
  assert(b('3 3 3 3', '3 4 5 6 7 8 9 10 J Q K A'));
});

test('responses are all legal and beat the play', () => {
  const h = hand('3 3 4 5 5 5 6 7 8 9 9 9 9 J J Q K A 2 x X');
  for (const prevText of ['4', '8 8', '4 4 4', '4 4 4 6', '4 4 4 6 6', '3 4 5 6 7', '10 10 10 10', '3 3 4 4 5 5']) {
    const prev = DDZ.analyze(hand(prevText));
    const opts = DDZ.responses(h, prev);
    assert(opts.length > 0, 'expected a reply to ' + prevText);
    for (const o of opts) {
      assert(o.every(id => h.includes(id)) && new Set(o).size === o.length, 'cards come from the hand');
      assert(DDZ.beats(DDZ.analyze(o), prev), `reply to ${prevText} must beat it`);
    }
  }
  assert.deepStrictEqual(DDZ.responses(hand('3 4 5'), DDZ.analyze(hand('x X'))), []);
  assert.deepStrictEqual(DDZ.responses(hand('3 4 5'), DDZ.analyze(hand('6'))), []);
});

test('bidding, landlord and scoring', () => {
  let st = DDZ.newGame(Math.random, 0);
  assert.strictEqual(st.hands.flat().length + st.bottom.length, 54);
  assert.strictEqual(new Set(st.hands.flat().concat(st.bottom)).size, 54);
  assert(!DDZ.bid(st, 1, 1).ok, 'wrong player cannot bid');
  DDZ.bid(st, 0, 0); DDZ.bid(st, 1, 0); DDZ.bid(st, 2, 0);
  assert.strictEqual(st.phase, 'redeal');

  st = DDZ.newGame(Math.random, 0);
  DDZ.bid(st, 0, 1);
  assert(!DDZ.bid(st, 1, 1).ok, 'must outbid');
  DDZ.bid(st, 1, 2); DDZ.bid(st, 2, 0);
  assert.strictEqual(st.phase, 'play');
  assert.strictEqual(st.landlord, 1);
  assert.strictEqual(st.hands[1].length, 20);
  assert.strictEqual(st.turn, 1);
  assert(!DDZ.pass(st, 1).ok, 'cannot pass on a free lead');

  // Spring: landlord plays everything, farmers never play.
  st = DDZ.newGame(Math.random, 0);
  DDZ.bid(st, 0, 3);
  st.hands[0] = hand('3 4 5 6 7');
  assert(DDZ.play(st, 0, st.hands[0].slice()).ok);
  assert.strictEqual(st.phase, 'over');
  assert.strictEqual(st.result.spring, 'spring');
  assert.deepStrictEqual(st.result.delta, [12, -6, -6]);
});

test('AI decomposition covers the whole hand', () => {
  const h = hand('3 3 4 5 5 5 6 7 8 9 9 9 9 J J Q K A 2 x X');
  const d = AI.decompose(h);
  assert.deepStrictEqual(d.combos.flatMap(c => c.cards).sort((a, b) => a - b), h.slice().sort((a, b) => a - b));
  for (const c of d.combos) assert(DDZ.analyze(c.cards), 'every combination is a legal play: ' + c.type);
});

test('AI self-play: 400 full games with only legal moves', () => {
  let seed = 12345;
  const rng = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  let games = 0, landlordWins = 0, redeals = 0, turns = 0, bombs = 0;
  while (games < 400) {
    const st = DDZ.newGame(rng);
    while (st.phase === 'bid') {
      const p = st.bidTurn;
      assert(DDZ.bid(st, p, AI.chooseBid(st.hands[p], st.highBid)).ok);
    }
    if (st.phase === 'redeal') { redeals++; assert(redeals < 5000, 'too many redeals'); continue; }
    let guard = 0;
    while (st.phase === 'play') {
      assert(++guard < 400, 'game did not end');
      const p = st.turn;
      const ctx = { me: p, landlord: st.landlord, left: st.hands.map(h => h.length), unseen: DDZ.unseen(st, p) };
      const cards = st.last ? AI.chooseFollow(st.hands[p], st.last, ctx) : AI.chooseLead(st.hands[p], ctx);
      const r = cards ? DDZ.play(st, p, cards) : DDZ.pass(st, p);
      assert(r.ok, `illegal AI move: ${r.error} with ${JSON.stringify(cards)}`);
      turns++;
    }
    assert.strictEqual(st.result.delta.reduce((a, b) => a + b, 0), 0, 'scores are zero-sum');
    if (st.result.landlordWon) landlordWins++;
    if (st.mult > 1) bombs++;
    games++;
  }
  console.log(`  self-play: ${games} games, ${redeals} redeals, landlord won ${Math.round(landlordWins / games * 100)}%, ` +
    `${(turns / games).toFixed(1)} turns per game, ${bombs} games with a multiplier`);
});

console.log(`${passed} test groups passed`);
