'use strict';
// Claude Code hook: forwards a tiny summary of the event to the Meanwhile
// bridge on localhost. Never prints, never fails, and sends no prompt text or
// tool output. If the bridge is not running it exits quietly.
const http = require('http');

const PORT = Number(process.env.MEANWHILE_PORT) || 4517;
const done = () => process.exit(0);
setTimeout(done, 1500);

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
  const req = http.request({
    host: '127.0.0.1',
    port: PORT,
    path: '/hook',
    method: 'POST',
    timeout: 800,
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
  }, res => { res.resume(); res.on('end', done); });
  req.on('error', done);
  req.on('timeout', () => { req.destroy(); done(); });
  req.end(body);
});
