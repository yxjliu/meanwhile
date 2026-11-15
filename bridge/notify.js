'use strict';
// Claude Code hook: forwards a tiny summary of the event to the Meanwhile
// bridge on localhost. Never prints, never fails, and sends no prompt text or
// tool output.
//
// If the bridge is not running, it starts it in the background (no window)
// and tries once more, so the games can always see what Claude is doing.
// Stop the bridge with stop.bat, or turn all of this off with
//   node bridge/install-hooks.js --uninstall
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT = Number(process.env.MEANWHILE_PORT) || 4517;
const CONFIG = path.join(__dirname, 'meanwhile.json');       // written by install-hooks.js
const STAMP = path.join(__dirname, 'meanwhile.last-start');  // when we last tried to start the bridge
const done = () => process.exit(0);
setTimeout(done, 4000);

function send(body, onFail) {
  const req = http.request({
    host: '127.0.0.1',
    port: PORT,
    path: '/hook',
    method: 'POST',
    timeout: 800,
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
  }, res => { res.resume(); res.on('end', done); });
  req.on('error', onFail);
  req.on('timeout', () => { req.destroy(); });
  req.end(body);
}

function startBridge() {
  try {
    const { server } = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
    if (!server || !fs.existsSync(server)) return false;
    // Several hooks can fire at once; only one of them should launch it.
    let last = 0;
    try { last = Number(fs.readFileSync(STAMP, 'utf8')) || 0; } catch { /* first time */ }
    if (Date.now() - last < 15000) return true;
    fs.writeFileSync(STAMP, String(Date.now()));
    spawn(process.execPath, [server], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    return true;
  } catch {
    return false;
  }
}

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', c => { raw += c; });
process.stdin.on('error', done);
process.stdin.on('end', () => {
  let h;
  try { h = JSON.parse(raw.replace(/^﻿/, '')); } catch { return done(); }
  const body = JSON.stringify({
    hook_event_name: h.hook_event_name,
    session_id: h.session_id,
    cwd: h.cwd,
    notification_type: h.notification_type,
    message: h.hook_event_name === 'Notification' ? h.message : undefined,
  });
  send(body, err => {
    const down = err && (err.code === 'ECONNREFUSED' || err.code === 'ECONNRESET');
    if (!down || h.hook_event_name === 'SessionEnd' || !startBridge()) return done();
    let tries = 0;
    const retry = () => { if (++tries > 4) return done(); setTimeout(() => send(body, retry), 500); };
    retry();
  });
});
