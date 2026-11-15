// 斗地主 rules engine: cards, hand types, legal replies and the game state machine.
// Pure logic with no DOM, so it runs in the browser and under Node for tests.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DDZ = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Cards are ids 0..53. Ranks: 3..10, J=11, Q=12, K=13, A=14, 2=15, 小王=16, 大王=17.
  const LABELS = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A', 15: '2', 16: '小王', 17: '大王' };
  const rankOf = id => (id < 52 ? 3 + (id >> 2) : id === 52 ? 16 : 17);
  const suitOf = id => (id < 52 ? id & 3 : 4);
  const label = r => LABELS[r] || String(r);
  const sortHand = cards => cards.slice().sort((a, b) => rankOf(b) - rankOf(a) || b - a);

  function counts(cards) {
    const c = new Array(18).fill(0);
    for (const id of cards) c[rankOf(id)]++;
    return c;
  }
  function groups(cards) {
    const g = {};
    for (const id of cards) (g[rankOf(id)] || (g[rankOf(id)] = [])).push(id);
    return g;
  }

  /** Top ranks (ascending) of every run of `len` consecutive ranks 3..A that each have at least `need` cards. */
  function runTops(c, need, len) {
    const tops = [];
    for (let top = 3 + len - 1; top <= 14; top++) {
      let ok = true;
      for (let r = top - len + 1; r <= top; r++) if (c[r] < need) { ok = false; break; }
      if (ok) tops.push(top);
    }
    return tops;
  }

  /**
   * Classify a set of cards. Returns null if it is not a legal play, else
   * { type, main, len, size } where main is the rank used to compare plays.
   */
  function analyze(cards) {
    const n = cards.length;
    if (!n) return null;
    const c = counts(cards);
    const ranks = [];
    for (let r = 3; r <= 17; r++) if (c[r]) ranks.push(r);
    const withCount = k => ranks.filter(r => c[r] === k);
    const mk = (type, main, len) => ({ type, main, len: len || 1, size: n });
    const chain = () => ranks[ranks.length - 1] <= 14 && ranks.every((r, i) => i === 0 || r === ranks[i - 1] + 1);
    const top = ranks[ranks.length - 1];

    if (n === 1) return mk('single', top);
    if (n === 2) {
      if (c[16] && c[17]) return mk('rocket', 17);
      return ranks.length === 1 ? mk('pair', top) : null;
    }
    if (n === 3) return ranks.length === 1 ? mk('triple', top) : null;
    if (n === 4) {
      if (ranks.length === 1) return mk('bomb', top);
      const t = withCount(3);
      return t.length === 1 ? mk('triple1', t[0]) : null;
    }
    if (ranks.length === n && chain()) return mk('straight', top, n);
    if (n === 5) {
      const t = withCount(3), p = withCount(2);
      if (t.length === 1 && p.length === 1) return mk('triple2', t[0]);
    }
    if (n % 2 === 0 && ranks.length === n / 2 && ranks.every(r => c[r] === 2) && chain()) return mk('pairs', top, n / 2);
    if (n % 3 === 0 && ranks.length === n / 3 && ranks.every(r => c[r] === 3) && chain()) return mk('plane', top, n / 3);
    if (n % 4 === 0) {
      // 飞机带单: k consecutive triples plus any k other cards
      const k = n / 4, tops = runTops(c, 3, k);
      if (k >= 2 && tops.length) return mk('plane1', tops[tops.length - 1], k);
    }
    if (n % 5 === 0) {
      // 飞机带对: k consecutive triples plus k pairs
      const k = n / 5, tops = runTops(c, 3, k);
      for (let i = tops.length - 1; k >= 2 && i >= 0; i--) {
        const t = tops[i];
        let ok = true;
        for (const r of ranks) {
          const rest = c[r] - (r > t - k && r <= t ? 3 : 0);
          if (rest % 2) { ok = false; break; }
        }
        if (ok) return mk('plane2', t, k);
      }
    }
    if (n === 6) {
      const f = withCount(4);
      if (f.length === 1) return mk('four2', f[0]);
    }
    if (n === 8) {
      const f = withCount(4), p = withCount(2);
      if (f.length === 1 && p.length === 2) return mk('four22', f[0]);
      if (f.length === 2) return mk('four22', Math.max(f[0], f[1]));
    }
    return null;
  }

  /** Does play `a` beat play `b`? Both are analyze() results; b may be null (free lead). */
  function beats(a, b) {
    if (!a) return false;
    if (!b) return true;
    if (a.type === 'rocket') return true;
    if (b.type === 'rocket') return false;
    if (a.type === 'bomb') return b.type !== 'bomb' || a.main > b.main;
    if (b.type === 'bomb') return false;
    return a.type === b.type && a.size === b.size && a.main > b.main;
  }

  // Cheapest kickers first: loose low cards, then cards that break pairs, triples, bombs.
  function pickSingles(g, exclude, k) {
    const pool = [];
    for (const r in g) {
      const rank = Number(r);
      if (exclude.has(rank)) continue;
      const n = g[r].length;
      const cost = (n === 1 ? 0 : n === 2 ? 100 : n === 3 ? 200 : 400) + (rank >= 16 ? 250 : rank === 15 ? 120 : 0) + rank;
      g[r].forEach((id, i) => pool.push({ id, cost: cost + i * 0.01 }));
    }
    if (pool.length < k) return null;
    return pool.sort((a, b) => a.cost - b.cost).slice(0, k).map(p => p.id);
  }
  function pickPairs(g, exclude, k) {
    const pool = [];
    for (const r in g) {
      const rank = Number(r), n = g[r].length;
      if (exclude.has(rank) || n < 2 || rank > 15) continue;
      const cost = (n === 2 ? 0 : n === 3 ? 100 : 300) + (rank === 15 ? 120 : 0) + rank;
      pool.push({ cards: g[r].slice(0, 2), cost });
      if (n === 4) pool.push({ cards: g[r].slice(2, 4), cost: cost + 1 });
    }
    if (pool.length < k) return null;
    return pool.sort((a, b) => a.cost - b.cost).slice(0, k).flatMap(p => p.cards);
  }

  /**
   * Every way `hand` can beat `prev` (an analyze() result), weakest first:
   * same-type plays, then bombs, then the rocket. Kickers are chosen for you.
   */
  function responses(hand, prev) {
    const out = [];
    const g = groups(hand), c = counts(hand);
    const take = (r, k) => g[r].slice(0, k);
    const run = (top, len, k) => { const cards = []; for (let r = top - len + 1; r <= top; r++) cards.push(...take(r, k)); return cards; };
    const runSet = (top, len) => { const s = new Set(); for (let r = top - len + 1; r <= top; r++) s.add(r); return s; };
    const m = prev.main, len = prev.len;

    switch (prev.type) {
      case 'single': for (let r = m + 1; r <= 17; r++) if (c[r] >= 1) out.push(take(r, 1)); break;
      case 'pair': for (let r = m + 1; r <= 15; r++) if (c[r] >= 2) out.push(take(r, 2)); break;
      case 'triple': for (let r = m + 1; r <= 15; r++) if (c[r] >= 3) out.push(take(r, 3)); break;
      case 'triple1':
        for (let r = m + 1; r <= 15; r++) if (c[r] >= 3) { const k = pickSingles(g, new Set([r]), 1); if (k) out.push([...take(r, 3), ...k]); }
        break;
      case 'triple2':
        for (let r = m + 1; r <= 15; r++) if (c[r] >= 3) { const k = pickPairs(g, new Set([r]), 1); if (k) out.push([...take(r, 3), ...k]); }
        break;
      case 'straight': for (const t of runTops(c, 1, len)) if (t > m) out.push(run(t, len, 1)); break;
      case 'pairs': for (const t of runTops(c, 2, len)) if (t > m) out.push(run(t, len, 2)); break;
      case 'plane': for (const t of runTops(c, 3, len)) if (t > m) out.push(run(t, len, 3)); break;
      case 'plane1':
        for (const t of runTops(c, 3, len)) if (t > m) { const k = pickSingles(g, runSet(t, len), len); if (k) out.push([...run(t, len, 3), ...k]); }
        break;
      case 'plane2':
        for (const t of runTops(c, 3, len)) if (t > m) { const k = pickPairs(g, runSet(t, len), len); if (k) out.push([...run(t, len, 3), ...k]); }
        break;
      case 'four2':
        for (let r = m + 1; r <= 15; r++) if (c[r] === 4) { const k = pickSingles(g, new Set([r]), 2); if (k) out.push([...take(r, 4), ...k]); }
        break;
      case 'four22':
        for (let r = m + 1; r <= 15; r++) if (c[r] === 4) { const k = pickPairs(g, new Set([r]), 2); if (k) out.push([...take(r, 4), ...k]); }
        break;
      default: break;
    }
    if (prev.type !== 'rocket') {
      for (let r = 3; r <= 15; r++) if (c[r] === 4 && (prev.type !== 'bomb' || r > m)) out.push(take(r, 4));
      if (c[16] && c[17]) out.push([g[16][0], g[17][0]]);
    }
    return out;
  }

  // ---------- game state machine (plain JSON, safe to save and restore) ----------
  function shuffle(a, rng) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function newGame(rng, firstBidder) {
    rng = rng || Math.random;
    const deck = shuffle(Array.from({ length: 54 }, (_, i) => i), rng);
    return {
      phase: 'bid',                       // bid | play | over | redeal
      hands: [0, 1, 2].map(p => sortHand(deck.slice(p * 17, p * 17 + 17))),
      bottom: sortHand(deck.slice(51)),
      bidTurn: firstBidder == null ? Math.floor(rng() * 3) : firstBidder,
      bidCount: 0, highBid: 0, highBidder: -1,
      landlord: -1, turn: -1, base: 0, mult: 1,
      last: null,                         // { player, cards, info } of the play to beat
      passes: 0, playsBy: [0, 0, 0], played: [], history: [], result: null,
    };
  }

  function bid(st, p, n) {
    if (st.phase !== 'bid' || p !== st.bidTurn) return { ok: false, error: 'not your turn' };
    if (n !== 0 && !(Number.isInteger(n) && n > st.highBid && n <= 3)) return { ok: false, error: 'bad bid' };
    if (n > st.highBid) { st.highBid = n; st.highBidder = p; }
    st.bidCount++;
    st.history.push({ p, bid: n });
    if (n === 3 || st.bidCount === 3) {
      if (st.highBidder < 0) { st.phase = 'redeal'; return { ok: true }; }
      const l = st.highBidder;
      st.landlord = l;
      st.hands[l] = sortHand(st.hands[l].concat(st.bottom));
      st.base = st.highBid;
      st.phase = 'play';
      st.turn = l;
    } else {
      st.bidTurn = (p + 1) % 3;
    }
    return { ok: true };
  }

  function play(st, p, cards) {
    if (st.phase !== 'play' || p !== st.turn) return { ok: false, error: 'not your turn' };
    const hand = st.hands[p];
    const set = new Set(cards);
    if (set.size !== cards.length || !cards.every(id => hand.includes(id))) return { ok: false, error: 'not your cards' };
    const info = analyze(cards);
    if (!info) return { ok: false, error: 'not a legal hand' };
    if (st.last && !beats(info, st.last.info)) return { ok: false, error: 'does not beat' };

    st.hands[p] = hand.filter(id => !set.has(id));
    st.last = { player: p, cards: cards.slice(), info };
    st.passes = 0;
    st.playsBy[p]++;
    st.played.push(...cards);
    st.history.push({ p, cards: cards.slice() });
    if (info.type === 'bomb' || info.type === 'rocket') st.mult *= 2;

    if (!st.hands[p].length) finish(st, p);
    else st.turn = (p + 1) % 3;
    return { ok: true, info };
  }

  function pass(st, p) {
    if (st.phase !== 'play' || p !== st.turn) return { ok: false, error: 'not your turn' };
    if (!st.last) return { ok: false, error: 'you must lead' };
    st.history.push({ p, pass: true });
    st.passes++;
    if (st.passes === 2) { st.last = null; st.passes = 0; }
    st.turn = (p + 1) % 3;
    return { ok: true };
  }

  function finish(st, winner) {
    const l = st.landlord;
    const landlordWon = winner === l;
    const farmers = [0, 1, 2].filter(p => p !== l);
    let spring = '';
    if (landlordWon && farmers.every(p => st.playsBy[p] === 0)) spring = 'spring';
    if (!landlordWon && st.playsBy[l] === 1) spring = 'anti';
    if (spring) st.mult *= 2;
    const unit = st.base * st.mult;
    const delta = [0, 0, 0];
    delta[l] = (landlordWon ? 2 : -2) * unit;
    for (const p of farmers) delta[p] = (landlordWon ? -1 : 1) * unit;
    st.result = { winner, landlordWon, spring, unit, delta };
    st.phase = 'over';
    st.turn = -1;
  }

  /** Cards the given player cannot see: everything not in their hand and not yet played. */
  function unseen(st, p) {
    const c = new Array(18).fill(0);
    for (let r = 3; r <= 15; r++) c[r] = 4;
    c[16] = c[17] = 1;
    for (const id of st.hands[p]) c[rankOf(id)]--;
    for (const id of st.played) c[rankOf(id)]--;
    return c;
  }

  return {
    rankOf, suitOf, label, sortHand, counts, groups, runTops,
    analyze, beats, responses, pickSingles, pickPairs,
    newGame, bid, play, pass, unseen,
  };
});
