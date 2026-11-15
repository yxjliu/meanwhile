'use strict';
// Meanwhile bridge.
// Serves the games on http://localhost:4517 and relays Claude Code hook events
// (prompt submitted, turn finished, permission needed) to the open game page
// over Server-Sent Events. It listens on 127.0.0.1 only.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const PORT = Number(process.env.MEANWHILE_PORT) || 4517;
const HOST = '127.0.0.1';
const ROOT = path.resolve(__dirname, '..');
const URL_HOME = `http://localhost:${PORT}/`;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.woff2': 'font/woff2',
};
const PRIVATE_DIRS = new Set(['bridge', 'tests', 'node_modules']);

/** session id -> { id, project, state: 'working' | 'done' | 'needs', since, workSince, message } */
const sessions = new Map();
const clients = new Set();

const snapshot = () => ({ now: Date.now(), sessions: [...sessions.values()] });

function emit(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(msg);
}

function onHook(h) {
  const id = String(h.session_id || 'unknown');
  const now = Date.now();
  const project = h.cwd ? path.basename(String(h.cwd).replace(/[\\/]+$/, '')) : '';
  let s = sessions.get(id);
  const ensure = () => {
    if (!s) {
      s = { id, project, state: 'working', since: now, workSince: now, message: '' };
      sessions.set(id, s);
    }
    if (project) s.project = project;
  };
  let attention = null;

  switch (h.hook_event_name) {
    case 'UserPromptSubmit':
      ensure();
      s.state = 'working';
      s.since = s.workSince = now;
      s.message = '';
      break;
    case 'PostToolUse':
      // Only used to notice that a permission prompt was answered.
      if (s && s.state !== 'needs') return;
      ensure();
      s.state = 'working';
      s.since = s.workSince || now;
      s.message = '';
      break;
    case 'Stop':
    case 'StopFailure':
      ensure();
      s.state = 'done';
      s.since = now;
      attention = { kind: 'done', project: s.project };
      break;
    case 'Notification': {
      const type = String(h.notification_type || '');
      const message = String(h.message || '').slice(0, 160);
      // The idle reminder repeats what Stop already told us.
      if (type === 'idle_prompt' || type === 'auth_success' || /waiting for your input/i.test(message)) return;
      ensure();
      s.state = 'needs';
      s.since = now;
      s.message = message;
      attention = { kind: 'needs', project: s.project, message };
      break;
    }
    case 'SessionEnd':
      if (!sessions.delete(id)) return;
      break;
    default:
      return;
  }
  emit('state', snapshot());
  if (attention) emit('attention', attention);
}

// Forget sessions that never told us they ended.
setInterval(() => {
  const now = Date.now();
  let changed = false;
  for (const [id, s] of sessions) {
    if (now - s.since > 12 * 3600 * 1000) { sessions.delete(id); changed = true; }
  }
  if (changed) emit('state', snapshot());
}, 60 * 1000).unref();

function allowedOrigin(origin) {
  if (!origin) return null;
  if (origin === 'null') return origin; // a page opened straight from disk
  if (/^https:\/\/[a-z0-9-]+\.github\.io$/i.test(origin)) return origin;
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) return origin;
  return null;
}

function cors(req, res) {
  const origin = allowedOrigin(req.headers.origin);
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  return origin;
}

function readBody(req, limit, cb) {
  let size = 0;
  const chunks = [];
  req.on('data', c => {
    size += c.length;
    if (size > limit) { req.destroy(); return; }
    chunks.push(c);
  });
  req.on('end', () => cb(Buffer.concat(chunks).toString('utf8')));
  req.on('error', () => {});
}

function serveStatic(req, res, pathname) {
  let rel;
  try { rel = decodeURIComponent(pathname); } catch { res.writeHead(400).end(); return; }
  const parts = rel.split('/').filter(Boolean);
  if (parts.some(p => p.startsWith('.')) || PRIVATE_DIRS.has(parts[0])) { res.writeHead(404).end('Not found'); return; }
  let file = path.join(ROOT, ...parts);
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) { res.writeHead(404).end('Not found'); return; }
  fs.stat(file, (err, stat) => {
    if (!err && stat.isDirectory()) {
      if (!pathname.endsWith('/')) { res.writeHead(302, { Location: pathname + '/' }).end(); return; }
      file = path.join(file, 'index.html');
    }
    fs.readFile(file, (e, data) => {
      if (e) { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found'); return; }
      res.writeHead(200, {
        'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
      });
      res.end(data);
    });
  });
}

const server = http.createServer((req, res) => {
  const { pathname } = new URL(req.url, URL_HOME);

  if (req.method === 'OPTIONS') {
    if (cors(req, res)) {
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST');
      res.setHeader('Access-Control-Allow-Private-Network', 'true');
    }
    res.writeHead(204).end();
    return;
  }

  if (pathname === '/hook' && req.method === 'POST') {
    // Hooks come from a local process, never from a web page.
    if (req.headers.origin) { res.writeHead(403).end(); return; }
    readBody(req, 64 * 1024, body => {
      try { onHook(JSON.parse(body)); } catch { /* ignore malformed input */ }
      res.writeHead(204).end();
    });
    return;
  }

  if (pathname === '/events' && req.method === 'GET') {
    cors(req, res);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write('retry: 2000\n\n');
    res.write(`event: state\ndata: ${JSON.stringify(snapshot())}\n\n`);
    clients.add(res);
    const beat = setInterval(() => res.write(': beat\n\n'), 20000);
    req.on('close', () => { clearInterval(beat); clients.delete(res); });
    return;
  }

  if (pathname === '/state' && req.method === 'GET') {
    cors(req, res);
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(snapshot()));
    return;
  }

  if (pathname === '/ack' && req.method === 'POST') {
    // "I've seen it": clear finished sessions so the waiting clock stops.
    if (req.headers.origin && !cors(req, res)) { res.writeHead(403).end(); return; }
    for (const [id, s] of sessions) if (s.state !== 'working') sessions.delete(id);
    emit('state', snapshot());
    res.writeHead(204).end();
    return;
  }

  if (req.method === 'GET' || req.method === 'HEAD') { serveStatic(req, res, pathname); return; }
  res.writeHead(405).end();
});

function openBrowser() {
  const cmd = process.platform === 'win32' ? `start "" "${URL_HOME}"`
    : process.platform === 'darwin' ? `open "${URL_HOME}"` : `xdg-open "${URL_HOME}"`;
  exec(cmd, () => {});
}

const wantOpen = process.argv.includes('--open');

server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.log(`Meanwhile is already running at ${URL_HOME}`);
    if (wantOpen) openBrowser();
    setTimeout(() => process.exit(0), 300);
    return;
  }
  throw err;
});

server.listen(PORT, HOST, () => {
  console.log(`Meanwhile is running at ${URL_HOME}`);
  console.log('Leave this window open while you play. Close it to stop.');
  if (wantOpen) openBrowser();
});
