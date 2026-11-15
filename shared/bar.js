// Meanwhile top bar: play clock, Claude status and the "go look" alert.
// Games listen for:
//   window 'meanwhile:attention' -> pause now, Claude wants you
//   window 'meanwhile:dismiss'   -> the player chose to keep playing
(() => {
  'use strict';
  const script = document.currentScript;
  const ROOT = (script && script.dataset.root) || './';
  const PORT = 4517;
  const onLocalhost = /^https?:$/.test(location.protocol) && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  const BRIDGE = onLocalhost ? '' : `http://127.0.0.1:${PORT}`;
  const NAG_EVERY = 180; // seconds between repeat alerts while Claude is still waiting
  const LINK_KEY = 'mw.link';

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
  };
  const tab = {
    get(k, d) { try { const v = sessionStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
  };
  const fmt = s => {
    s = Math.max(0, Math.floor(s));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return (h ? `${h}:${String(m).padStart(2, '0')}` : String(m)) + ':' + String(x).padStart(2, '0');
  };
  const today = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  // ---------- DOM ----------
  const bar = document.createElement('header');
  bar.className = 'mw-bar';
  bar.innerHTML = `
    <a class="mw-home" href="${ROOT}index.html"><span>◆</span>Meanwhile</a>
    <div class="mw-play" title="Time with this tab in front">
      <span>Playing</span><b id="mw-sit">0:00</b><span>today</span><b id="mw-day">0:00</b>
    </div>
    <div class="mw-claude">
      <button class="mw-pill off" id="mw-pill" type="button"><i class="mw-dot"></i><span id="mw-status">Looking for Claude…</span><b id="mw-clock"></b></button>
      <span class="mw-manual" id="mw-manual" hidden>
        <select id="mw-mins" aria-label="Reminder minutes">
          <option value="3">3 min</option><option value="5" selected>5 min</option><option value="10">10 min</option>
          <option value="15">15 min</option><option value="20">20 min</option><option value="30">30 min</option>
        </select>
        <button id="mw-remind" type="button">Remind me</button>
      </span>
    </div>`;
  const banner = document.createElement('div');
  banner.className = 'mw-banner';
  banner.hidden = true;
  banner.setAttribute('role', 'alert');
  banner.innerHTML = '<span id="mw-banner-text"></span><button id="mw-banner-btn" type="button">Keep playing</button>';
  document.body.prepend(bar);
  document.body.append(banner);

  const $ = id => document.getElementById(id);
  const pill = $('mw-pill'), statusEl = $('mw-status'), clockEl = $('mw-clock');
  const manual = $('mw-manual'), minsSel = $('mw-mins'), remindBtn = $('mw-remind');
  minsSel.value = String(store.get('mw.remindMins', 5));

  // ---------- play clock ----------
  let sitting = tab.get('mw.sitting', 0);
  let dayKey = today();
  let daySecs = store.get('mw.play.' + dayKey, 0);
  setInterval(() => {
    if (document.visibilityState !== 'visible') return;
    sitting += 1;
    if (today() !== dayKey) { dayKey = today(); daySecs = 0; }
    daySecs += 1;
    tab.set('mw.sitting', sitting);
    store.set('mw.play.' + dayKey, daySecs);
    $('mw-sit').textContent = fmt(sitting);
    $('mw-day').textContent = fmt(daySecs);
  }, 1000);
  $('mw-sit').textContent = fmt(sitting);
  $('mw-day').textContent = fmt(daySecs);

  // ---------- sound + title flash ----------
  let audio = null;
  const wake = () => {
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === 'suspended') audio.resume();
    } catch { /* no audio */ }
  };
  addEventListener('keydown', wake, { passive: true });
  addEventListener('pointerdown', wake, { passive: true });
  function chime() {
    if (!audio || audio.state !== 'running') return;
    [880, 1108.7, 1318.5].forEach((f, i) => {
      const o = audio.createOscillator(), g = audio.createGain();
      const t = audio.currentTime + i * 0.14;
      o.type = 'sine';
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.22, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
      o.connect(g).connect(audio.destination);
      o.start(t);
      o.stop(t + 0.55);
    });
  }
  const baseTitle = document.title;
  let flash = 0;
  function startFlash() {
    stopFlash();
    let on = false;
    flash = setInterval(() => { on = !on; document.title = on ? '● Claude is ready' : baseTitle; }, 900);
  }
  function stopFlash() { clearInterval(flash); flash = 0; document.title = baseTitle; }

  // ---------- alert ----------
  let lastAlert = Date.now();
  function attention(detail) {
    const where = detail.project ? ` in ${detail.project}` : '';
    const text = {
      done: `Claude finished${where}. Go take a look.`,
      needs: `Claude needs you${where}${detail.message ? ': ' + detail.message : '.'}`,
      timer: 'Time is up. Go check on Claude.',
      nag: `Claude is still waiting on you${detail.waited ? ' (' + detail.waited + ')' : ''}.`,
    }[detail.kind] || 'Claude wants you.';
    $('mw-banner-text').textContent = text;
    banner.hidden = false;
    lastAlert = Date.now();
    chime();
    startFlash();
    dispatchEvent(new CustomEvent('meanwhile:attention', { detail }));
  }
  $('mw-banner-btn').addEventListener('click', () => {
    banner.hidden = true;
    stopFlash();
    dispatchEvent(new CustomEvent('meanwhile:dismiss'));
  });

  // ---------- bridge link ----------
  // On localhost the page and the bridge are the same server, so it always connects.
  // The hosted copy would have to reach into the visitor's own computer, which makes
  // the browser ask for permission. So there it stays off until someone turns it on.
  let online = false, sessions = [], skew = 0, source = null;
  let linkWanted = onLocalhost || store.get(LINK_KEY, false) === true;
  function setOnline(v) {
    if (online === v) return;
    online = v;
    dispatchEvent(new CustomEvent('meanwhile:link', { detail: { online } }));
  }
  function connect() {
    if (!linkWanted || source) return;
    let es;
    try { es = new EventSource(BRIDGE + '/events'); } catch { return; }
    source = es;
    es.addEventListener('state', e => {
      const d = JSON.parse(e.data);
      skew = Date.now() - d.now;
      sessions = d.sessions || [];
      setOnline(true);
      paint();
    });
    es.addEventListener('attention', e => attention(JSON.parse(e.data)));
    es.onerror = () => { setOnline(false); sessions = []; paint(); };
  }
  // This same page in the copy the bridge serves on this computer.
  function localUrl() {
    const root = new URL(ROOT, location.href).pathname;
    const rest = location.pathname.startsWith(root) ? location.pathname.slice(root.length) : '';
    return `http://localhost:${PORT}/${rest}`;
  }
  function setLink(want) {
    if (onLocalhost) return;
    linkWanted = !!want;
    store.set(LINK_KEY, linkWanted);
    if (linkWanted) connect();
    else {
      if (source) { source.close(); source = null; }
      sessions = [];
      setOnline(false);
    }
    paint();
  }

  pill.addEventListener('click', () => {
    if (online && sessions.some(s => s.state !== 'working')) {
      fetch(BRIDGE + '/ack', { method: 'POST' }).catch(() => {});
      banner.hidden = true;
      stopFlash();
    } else if (!online && tab.get('mw.remindAt', 0)) {
      tab.set('mw.remindAt', 0);
      paint();
    } else if (!online && !onLocalhost) {
      location.href = localUrl(); // the copy served by the bridge needs no browser permission
    }
  });
  remindBtn.addEventListener('click', () => {
    const mins = Number(minsSel.value) || 5;
    store.set('mw.remindMins', mins);
    tab.set('mw.remindAt', Date.now() + mins * 60000);
    paint();
  });

  function paint() {
    const now = Date.now();
    let cls = 'off', text = '', clock = '', title = '';
    if (online) {
      manual.hidden = true;
      const waiting = sessions.filter(s => s.state !== 'working');
      const working = sessions.filter(s => s.state === 'working');
      if (waiting.length) {
        const since = Math.min(...waiting.map(s => s.since));
        const secs = (now - skew - since) / 1000;
        cls = 'wait';
        text = waiting.some(s => s.state === 'needs') ? 'Claude needs you' : 'Claude is done, waiting on you';
        clock = fmt(secs);
        title = 'Click once you have looked, to stop this clock';
        if (banner.hidden && now - lastAlert > NAG_EVERY * 1000) attention({ kind: 'nag', waited: fmt(secs) });
      } else if (working.length) {
        const since = Math.min(...working.map(s => s.workSince || s.since));
        cls = 'work';
        text = 'Claude working' + (working.length > 1 ? ` ×${working.length}` : working[0].project ? ` · ${working[0].project}` : '');
        clock = fmt((now - skew - since) / 1000);
      } else {
        cls = 'idle';
        text = 'Claude idle';
      }
    } else {
      const at = tab.get('mw.remindAt', 0);
      if (at && now >= at) {
        tab.set('mw.remindAt', 0);
        attention({ kind: 'timer' });
      }
      if (at && now < at) {
        manual.hidden = true;
        cls = 'work';
        text = 'Check Claude in';
        clock = fmt((at - now) / 1000);
        title = 'Click to cancel the reminder';
      } else {
        manual.hidden = false;
        text = 'No Claude link';
        title = linkWanted
          ? 'Start play.bat on this computer to connect to Claude Code'
          : 'Timer only here. Click to open the copy on this computer, which shows Claude Code (start play.bat first).';
      }
    }
    pill.className = 'mw-pill ' + cls;
    pill.title = title;
    statusEl.textContent = text;
    clockEl.textContent = clock;
  }

  connect();
  paint();
  setInterval(paint, 500);

  window.Meanwhile = { attention, setLink, localUrl, isOnline: () => online, linkWanted: () => linkWanted, hosted: !onLocalhost };
})();
