// 斗地主 table: rendering, input and turn flow. Seat 0 is you, 1 sits to your
// right (plays after you), 2 to your left.
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const NAMES = ['你', '东东', '西西'];
  const SUITS = ['♠', '♥', '♣', '♦'];
  const SAVE = 'mw.ddz.game', TOTAL = 'mw.ddz.total';
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
  };

  let st = null;
  let table = [null, null, null]; // what each seat shows in the middle: { cards } or { text }
  let sel = new Set();
  let hintList = null, hintIdx = 0;
  let timer = 0, msgTimer = 0, toastTimer = 0;
  let total = store.get(TOTAL, { score: 0, wins: 0, games: 0 });

  // ---------- small helpers ----------
  function cardEl(id, cls) {
    const el = document.createElement('div');
    const r = DDZ.rankOf(id), s = DDZ.suitOf(id);
    if (r >= 16) {
      el.className = `card joker${r === 17 ? ' red' : ''}${cls ? ' ' + cls : ''}`;
      el.innerHTML = '<span class="rk">JOKER</span><span class="big">王</span>';
      el.title = DDZ.label(r);
    } else {
      el.className = `card${s === 1 || s === 3 ? ' red' : ''}${cls ? ' ' + cls : ''}`;
      el.innerHTML = `<span class="rk">${DDZ.label(r)}</span><span class="st">${SUITS[s]}</span><span class="big">${SUITS[s]}</span>`;
    }
    el.dataset.id = id;
    return el;
  }
  function backEl(cls) {
    const el = document.createElement('div');
    el.className = 'card back' + (cls ? ' ' + cls : '');
    return el;
  }
  // Show a play with its main group first: 三带一 reads 9 9 9 4, not 9 9 9 sorted by suit.
  function arrange(cards) {
    const c = DDZ.counts(cards);
    return cards.slice().sort((a, b) => c[DDZ.rankOf(b)] - c[DDZ.rankOf(a)] || DDZ.rankOf(b) - DDZ.rankOf(a) || b - a);
  }
  function say(text) {
    $('msg').textContent = text;
    clearTimeout(msgTimer);
    msgTimer = setTimeout(() => { $('msg').textContent = ''; }, 2000);
  }
  function toast(text, ms = 1300) {
    const t = $('toast');
    t.textContent = text;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, ms);
  }
  const ctxFor = p => ({ me: p, landlord: st.landlord, left: st.hands.map(h => h.length), unseen: DDZ.unseen(st, p) });
  const whoseTurn = () => (st.phase === 'bid' ? st.bidTurn : st.phase === 'play' ? st.turn : -1);
  const roleOf = p => (st.landlord < 0 ? '' : p === st.landlord ? '地主' : '农民');

  // ---------- rendering ----------
  function render() {
    const known = st.landlord >= 0;
    $('bottom').replaceChildren(...st.bottom.map(id => (known ? cardEl(id, 'xs') : backEl('xs'))));
    $('base').textContent = st.base || '–';
    $('mult').textContent = known ? '×' + st.mult : '–';
    $('total').textContent = total.score;

    // 记牌器: every card I cannot see, by rank.
    const un = DDZ.unseen(st, 0);
    const cells = [];
    for (let r = 17; r >= 3; r--) {
      const cell = document.createElement('div');
      cell.className = 'c' + (un[r] === 0 ? ' zero' : '') + (un[r] === 4 ? ' four' : '') + (r >= 16 ? ' joker' : '');
      cell.innerHTML = `<span>${r === 17 ? '大王' : r === 16 ? '小王' : DDZ.label(r)}</span><b>${un[r]}</b>`;
      cells.push(cell);
    }
    $('counter').replaceChildren(...cells);

    const turn = whoseTurn();
    for (const p of [1, 2]) {
      const seat = $('seat' + p), n = st.hands[p].length;
      seat.classList.toggle('active', turn === p);
      seat.classList.toggle('alarm', st.phase === 'play' && n > 0 && n <= 2);
      const role = seat.querySelector('.role');
      role.textContent = roleOf(p);
      role.classList.toggle('landlord', p === st.landlord);
      seat.querySelector('.n').textContent = n;
    }
    const mine = $('my-role');
    mine.textContent = roleOf(0);
    mine.classList.toggle('landlord', st.landlord === 0);
    document.querySelector('.me').classList.toggle('active', turn === 0);

    for (const p of [0, 1, 2]) {
      const box = $('played' + p), t = table[p];
      box.classList.toggle('tight', !!(t && t.cards && t.cards.length > 9));
      if (!t) box.replaceChildren();
      else if (t.cards) box.replaceChildren(...(t.hand ? DDZ.sortHand(t.cards) : arrange(t.cards)).map(id => cardEl(id, p === 0 && !t.hand ? '' : 'sm')));
      else {
        const s = document.createElement('span');
        s.className = 'say';
        s.textContent = t.text;
        box.replaceChildren(s);
      }
    }
    renderHand();
    renderActions();
  }

  function renderHand() {
    $('hand').replaceChildren(...st.hands[0].map(id => cardEl(id, sel.has(id) ? 'sel' : '')));
  }

  function renderActions() {
    const box = $('actions');
    const btn = (label, act, cls, disabled) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn ' + (cls || '');
      b.dataset.act = act;
      b.textContent = label;
      b.disabled = !!disabled;
      return b;
    };
    const turn = whoseTurn();
    if (st.phase === 'bid' && turn === 0) {
      box.replaceChildren(
        btn('不叫', 'bid0'),
        btn('1分', 'bid1', '', st.highBid >= 1),
        btn('2分', 'bid2', '', st.highBid >= 2),
        btn('3分', 'bid3', 'primary'),
      );
    } else if (st.phase === 'play' && turn === 0) {
      box.replaceChildren(btn('不出', 'pass', '', !st.last), btn('提示', 'hint'), btn('出牌', 'play', 'primary'));
    } else {
      const s = document.createElement('span');
      s.className = 'waiting';
      s.textContent = turn > 0 ? `${NAMES[turn]}${st.phase === 'bid' ? '在叫分…' : '在出牌…'}` : '';
      box.replaceChildren(s);
    }
  }

  // ---------- turn flow ----------
  function save() { store.set(SAVE, { st, table }); }

  function step() {
    save();
    hintList = null;
    render();
    clearTimeout(timer);
    if (st.phase === 'redeal') { toast('都不叫，重新发牌'); timer = setTimeout(start, 1400); return; }
    if (st.phase === 'over') { timer = setTimeout(showResult, 700); return; }
    const p = whoseTurn();
    if (p > 0) timer = setTimeout(() => aiTurn(p), st.phase === 'bid' ? 750 : 800 + Math.random() * 450);
  }

  function aiTurn(p) {
    if (st.phase === 'bid') return doBid(p, DDZAI.chooseBid(st.hands[p], st.highBid));
    const cards = st.last ? DDZAI.chooseFollow(st.hands[p], st.last, ctxFor(p)) : DDZAI.chooseLead(st.hands[p], ctxFor(p));
    return cards ? doPlay(p, cards) : doPass(p);
  }

  function doBid(p, n) {
    if (!DDZ.bid(st, p, n).ok) return;
    table[p] = { text: n ? n + '分' : '不叫' };
    if (st.phase === 'play') {
      table = [null, null, null];
      toast(`${NAMES[st.landlord]}当地主，底分 ${st.base}`);
    }
    step();
  }

  function doPlay(p, cards) {
    const lead = !st.last;
    const r = DDZ.play(st, p, cards);
    if (!r.ok) return r;
    if (lead) table = [null, null, null];
    table[p] = { cards: cards.slice() };
    if (r.info.type === 'bomb') toast('炸弹！倍数 ×2', 900);
    if (r.info.type === 'rocket') toast('王炸！倍数 ×2', 900);
    if (st.phase === 'over') {
      // Show what the others were still holding.
      for (const q of [0, 1, 2]) if (q !== p && st.hands[q].length) table[q] = { cards: st.hands[q].slice(), hand: true };
    }
    step();
    return r;
  }

  function doPass(p) {
    if (!DDZ.pass(st, p).ok) return;
    table[p] = { text: '不出' };
    step();
  }

  function showResult() {
    const r = st.result;
    if (!st.scored) {
      st.scored = true;
      total.score += r.delta[0];
      total.games += 1;
      if (r.delta[0] > 0) total.wins += 1;
      store.set(TOTAL, total);
      save();
      $('total').textContent = total.score;
    }
    const won = r.delta[0] > 0;
    const title = $('result-title');
    title.textContent = won ? '你赢了！' : '你输了';
    title.className = won ? 'win' : 'lose';
    const spring = r.spring === 'spring' ? ' · 春天 ×2' : r.spring === 'anti' ? ' · 反春 ×2' : '';
    $('result-detail').textContent = `底分 ${st.base} × 倍数 ${st.mult}${spring} · 累计 ${total.wins} 胜 / ${total.games} 局`;
    $('result-rows').replaceChildren(...[0, 1, 2].map(p => {
      const tr = document.createElement('tr');
      const d = r.delta[p];
      tr.innerHTML = `<td>${NAMES[p]}</td><td>${roleOf(p)}</td><td class="${d > 0 ? 'plus' : 'minus'}">${d > 0 ? '+' : ''}${d}</td>`;
      return tr;
    }));
    $('modal').hidden = false;
  }

  function start() {
    clearTimeout(timer);
    st = DDZ.newGame();
    table = [null, null, null];
    sel = new Set();
    $('modal').hidden = true;
    step();
  }

  // ---------- your moves ----------
  const myTurn = phase => st.phase === phase && whoseTurn() === 0;

  function humanPlay() {
    if (!myTurn('play')) return;
    const cards = [...sel];
    if (!cards.length) return say('先选要出的牌');
    const info = DDZ.analyze(cards);
    if (!info) return say('这不是一手合法的牌');
    if (st.last && !DDZ.beats(info, st.last.info)) return say('压不过上家');
    sel = new Set();
    doPlay(0, cards);
  }
  function humanPass() {
    if (!myTurn('play')) return;
    if (!st.last) return say('轮到你先出，不能不出');
    sel = new Set();
    doPass(0);
  }
  function humanHint() {
    if (!myTurn('play')) return;
    if (!hintList) { hintList = DDZAI.hints(st.hands[0], st.last, ctxFor(0)); hintIdx = 0; }
    if (!hintList.length) { sel = new Set(); renderHand(); return say('没有能压过的牌'); }
    sel = new Set(hintList[hintIdx++ % hintList.length]);
    renderHand();
  }

  $('actions').addEventListener('click', e => {
    const act = e.target.closest('button')?.dataset.act;
    if (!act) return;
    if (act.startsWith('bid')) { if (myTurn('bid')) doBid(0, Number(act.slice(3))); }
    else if (act === 'play') humanPlay();
    else if (act === 'pass') humanPass();
    else if (act === 'hint') humanHint();
  });
  $('again').addEventListener('click', start);
  $('redeal').addEventListener('click', start);

  // Click a card to lift it; drag across cards to lift several.
  let drag = null;
  const hand = $('hand');
  function toggle(cardNode) {
    const id = Number(cardNode.dataset.id);
    if (drag) { if (drag.has(id)) return; drag.add(id); }
    if (sel.has(id)) sel.delete(id); else sel.add(id);
    cardNode.classList.toggle('sel');
  }
  hand.addEventListener('pointerdown', e => {
    const c = e.target.closest('.card');
    if (!c) return;
    e.preventDefault();
    drag = new Set();
    toggle(c);
  });
  hand.addEventListener('pointerover', e => {
    if (!drag) return;
    const c = e.target.closest('.card');
    if (c) toggle(c);
  });
  addEventListener('pointerup', () => { drag = null; });
  addEventListener('pointercancel', () => { drag = null; });

  addEventListener('keydown', e => {
    if (e.target instanceof HTMLSelectElement || e.repeat) return;
    if (!$('modal').hidden) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); start(); } return; }
    if (e.key === 'Enter') { e.preventDefault(); humanPlay(); }
    else if (e.key === ' ') { e.preventDefault(); humanHint(); }
    else if (e.key === 'p' || e.key === 'P') humanPass();
    else if (e.key === 'Escape') { sel = new Set(); renderHand(); }
    else if (myTurn('bid') && /^[0-3]$/.test(e.key)) { const n = Number(e.key); if (n === 0 || n > st.highBid) doBid(0, n); }
  });

  // ---------- boot: resume a saved game if there is one ----------
  const saved = store.get(SAVE, null);
  if (saved && saved.st && Array.isArray(saved.st.hands) && ['bid', 'play', 'over'].includes(saved.st.phase)) {
    st = saved.st;
    table = Array.isArray(saved.table) ? saved.table : [null, null, null];
    step();
  } else {
    start();
  }

  window.DDZTable = { state: () => st, start };
})();
