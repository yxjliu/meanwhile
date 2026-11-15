// 斗地主 computer player. Heuristic, not search: it splits its hand into
// combinations, then picks plays that leave the tidiest hand behind.
// It only ever sees its own hand, the cards already played and how many
// cards each player holds.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'));
  else root.DDZAI = factory(root.DDZ);
})(typeof self !== 'undefined' ? self : this, function (DDZ) {
  'use strict';
  const { rankOf, analyze, responses, sortHand, counts } = DDZ;
  const ORDERS = [
    [], ['straight'], ['plane', 'straight', 'pairs'], ['plane', 'pairs', 'straight'],
    ['straight', 'plane', 'pairs'], ['pairs', 'straight', 'plane'], ['pairs', 'plane', 'straight'],
  ];
  const CHAIN = { plane: [3, 2], straight: [1, 5], pairs: [2, 3] }; // cards per rank, minimum length

  function split(hand, order) {
    const g = {};
    for (let r = 3; r <= 17; r++) g[r] = [];
    for (const id of hand) g[rankOf(id)].push(id);
    const pull = (r, k) => g[r].splice(0, k);
    const mk = (type, main, len, cards) => ({ type, main, len, cards });
    const combos = [];

    if (g[16].length && g[17].length) combos.push(mk('rocket', 17, 1, [...pull(16, 1), ...pull(17, 1)]));
    for (let r = 3; r <= 15; r++) if (g[r].length === 4) combos.push(mk('bomb', r, 1, pull(r, 4)));

    for (const type of order) {
      const [need, minLen] = CHAIN[type];
      for (;;) {
        let bestTop = 0, bestLen = 0, len = 0;
        for (let r = 3; r <= 15; r++) {
          if (r <= 14 && g[r].length >= need) { len++; continue; }
          if (len >= minLen && len > bestLen) { bestLen = len; bestTop = r - 1; }
          len = 0;
        }
        if (!bestLen) break;
        const cards = [];
        for (let r = bestTop - bestLen + 1; r <= bestTop; r++) cards.push(...pull(r, need));
        combos.push(mk(type, bestTop, bestLen, cards));
      }
    }

    const triples = [], pairs = [], singles = [];
    for (let r = 3; r <= 17; r++) {
      const n = g[r].length;
      if (n === 3) triples.push(mk('triple', r, 1, pull(r, 3)));
      else if (n === 2) pairs.push(mk('pair', r, 1, pull(r, 2)));
      else if (n === 1) singles.push(mk('single', r, 1, pull(r, 1)));
    }
    // Hang low loose cards on planes and triples as kickers; keep 2s and jokers free.
    const low = list => list.filter(c => c.main < 15);
    const drop = (list, items) => { for (const it of items) list.splice(list.indexOf(it), 1); };
    for (const c of combos) {
      if (c.type !== 'plane') continue;
      const s = low(singles).slice(0, c.len), p = low(pairs).slice(0, c.len);
      if (s.length === c.len) { c.type = 'plane1'; s.forEach(x => c.cards.push(...x.cards)); drop(singles, s); }
      else if (p.length === c.len) { c.type = 'plane2'; p.forEach(x => c.cards.push(...x.cards)); drop(pairs, p); }
    }
    for (const t of triples) {
      const s = low(singles)[0], p = low(pairs)[0];
      if (s) { t.type = 'triple1'; t.cards.push(...s.cards); drop(singles, [s]); }
      else if (p) { t.type = 'triple2'; t.cards.push(...p.cards); drop(pairs, [p]); }
    }
    const all = combos.concat(triples, pairs, singles);

    // Roughly "turns needed to get out", lower is better. Bombs and high cards win turns back.
    let score = 0;
    for (const c of all) {
      if (c.type === 'rocket') score -= 0.7;
      else if (c.type === 'bomb') score -= 0.5;
      else if (c.type === 'single') score += c.main >= 16 ? 0.3 : c.main === 15 ? 0.5 : 1 + (11 - c.main) * 0.03;
      else if (c.type === 'pair') score += c.main === 15 ? 0.6 : 1 + (11 - c.main) * 0.02;
      else score += c.cards.length >= 5 ? 0.9 : 1;
    }
    return { combos: all, score };
  }

  /** Best split of a hand into combinations. */
  function decompose(hand) {
    let best = null;
    for (const order of ORDERS) {
      const d = split(hand, order);
      if (!best || d.score < best.score) best = d;
    }
    return best;
  }

  // Can anything still unseen beat this combination (ignoring bombs)?
  function isTop(c, unseen) {
    const need = c.type === 'single' ? 1 : c.type === 'pair' ? 2 : /^triple/.test(c.type) ? 3 : 0;
    if (!need) return c.cards.length >= 5;
    for (let r = c.main + 1; r <= (need === 1 ? 17 : 15); r++) if (unseen[r] >= need) return false;
    return true;
  }

  const without = (hand, cards) => { const s = new Set(cards); return hand.filter(id => !s.has(id)); };

  /**
   * ctx: { me, landlord, left: [cards held by each player], unseen: counts by rank }
   */
  function chooseLead(hand, ctx) {
    if (analyze(hand)) return hand.slice();
    const { me, landlord, left, unseen } = ctx;
    const others = [0, 1, 2].filter(p => p !== me);
    const foes = me === landlord ? others : [landlord];
    const mate = me === landlord ? -1 : others.find(p => p !== landlord);
    const minFoe = Math.min(...foes.map(p => left[p]));
    const sorted = sortHand(hand);
    const lowest = sorted[sorted.length - 1];

    // Partner is on their last card: hand them something small.
    if (mate >= 0 && left[mate] === 1 && rankOf(lowest) < 14) return [lowest];

    const d = decompose(hand);
    const normal = d.combos.filter(c => c.type !== 'bomb' && c.type !== 'rocket');
    const bombs = d.combos.filter(c => c.type === 'bomb' || c.type === 'rocket').sort((a, b) => a.main - b.main);
    if (!normal.length) return bombs[0].cards;

    // Nearly out: cash the plays nobody can beat, then finish.
    const tops = normal.filter(c => isTop(c, unseen));
    if (tops.length && normal.length - tops.length <= 1) {
      return tops.sort((a, b) => b.cards.length - a.cards.length)[0].cards;
    }

    let pool = normal;
    if (minFoe === 1) {
      const multi = pool.filter(c => c.type !== 'single');
      if (multi.length) pool = multi;
      else return pool.sort((a, b) => b.main - a.main)[0].cards; // only singles left: lead the biggest
    } else if (minFoe === 2) {
      const notPair = pool.filter(c => c.type !== 'pair');
      if (notPair.length) pool = notPair;
    }
    // Get rid of low cards first, and prefer plays that shed several cards at once.
    const key = c => c.main - (c.cards.length >= 5 ? 4 : c.cards.length >= 4 ? 2 : c.cards.length === 3 ? 1 : 0);
    return pool.sort((a, b) => key(a) - key(b))[0].cards;
  }

  /** Returns the cards to play over `last`, or null to pass. */
  function chooseFollow(hand, last, ctx) {
    const opts = responses(hand, last.info);
    if (!opts.length) return null;
    const out = opts.find(o => o.length === hand.length);
    if (out) return out;

    const { me, landlord, left } = ctx;
    const from = last.player;
    const next = (me + 1) % 3;
    const friendly = me !== landlord && from !== landlord;
    const nextIsFoe = me === landlord || next === landlord;
    const foes = me === landlord ? [0, 1, 2].filter(p => p !== me) : [landlord];
    const minFoe = Math.min(...foes.map(p => left[p]));

    const normal = [], bombs = [];
    for (const o of opts) {
      const t = analyze(o).type;
      (t === 'bomb' || t === 'rocket' ? bombs : normal).push(o);
    }
    const base = decompose(hand).score;
    const cost = o => decompose(without(hand, o)).score - base + 1; // 0 = a natural play, higher = breaks up the hand
    const ranked = normal
      .map(o => ({ o, cost: cost(o), main: analyze(o).main }))
      .sort((a, b) => a.cost + a.main * 0.01 - (b.cost + b.main * 0.01));

    // The next player is an opponent on their last card: block with the biggest single.
    if (last.info.type === 'single' && nextIsFoe && left[next] === 1 && normal.length) return normal[normal.length - 1];

    if (friendly) {
      if (left[from] <= 2 || !ranked.length) return null;      // partner is about to go out
      if (!nextIsFoe) return null;                             // the landlord already passed; let partner lead
      const b = ranked[0];
      const small = (last.info.type === 'single' || last.info.type === 'pair') && last.info.main <= 11;
      return small && b.cost <= 0.15 && b.main <= 13 ? b.o : null;
    }

    const urgent = minFoe <= 4;
    if (ranked.length) {
      const b = ranked[0];
      if (!urgent) {
        if (b.cost > 1.6 && hand.length > 6) return null;      // would wreck the hand
        if (b.main >= 16 && last.info.main < 12 && left[from] > 6 && hand.length > 5) return null; // keep jokers for later
      }
      return b.o;
    }
    // Only a bomb can beat it.
    const afterBomb = decompose(without(hand, bombs[0])).combos.length;
    if (urgent || afterBomb <= 2 || (last.info.size >= 6 && Math.random() < 0.5)) return bombs[0];
    return null;
  }

  /** 0 = pass, otherwise 1..3. `high` is the highest bid so far. */
  function chooseBid(hand, high) {
    const c = counts(hand);
    let s = c[17] * 4 + c[16] * 3 + c[15] * 2 + c[14];
    for (let r = 3; r <= 15; r++) if (c[r] === 4) s += 3;
    if (c[16] && c[17]) s += 1;
    const want = s >= 11 ? 3 : s >= 8 ? 2 : s >= 6 ? 1 : 0;
    return want > high ? want : 0;
  }

  /** Suggestions for the human: ordered list of card sets. */
  function hints(hand, last, ctx) {
    if (last) return responses(hand, last.info);
    const first = chooseLead(hand, ctx);
    const rest = decompose(hand).combos
      .slice().sort((a, b) => a.main - b.main)
      .map(c => c.cards)
      .filter(c => c.length !== first.length || !c.every(id => first.includes(id)));
    return [first, ...rest];
  }

  return { decompose, chooseLead, chooseFollow, chooseBid, hints };
});
