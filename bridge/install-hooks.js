'use strict';
// Adds (or with --uninstall, removes) the Meanwhile hooks in your Claude Code
// user settings, so every Claude Code session on this computer tells the
// bridge when it starts working, finishes, or needs you.
//
//   node bridge/install-hooks.js
//   node bridge/install-hooks.js --uninstall
const fs = require('fs');
const os = require('os');
const path = require('path');

const claudeDir = path.join(os.homedir(), '.claude');
const hooksDir = path.join(claudeDir, 'hooks');
const settingsPath = path.join(claudeDir, 'settings.json');
const backupPath = path.join(claudeDir, 'settings.json.before-meanwhile');
const scriptDest = path.join(hooksDir, 'meanwhile-notify.js');
const EVENTS = ['UserPromptSubmit', 'PostToolUse', 'Stop', 'StopFailure', 'Notification', 'SessionEnd'];
const uninstall = process.argv.includes('--uninstall');

let settings = {};
if (fs.existsSync(settingsPath)) {
  const text = fs.readFileSync(settingsPath, 'utf8');
  try {
    settings = JSON.parse(text.replace(/^﻿/, ''));
  } catch (err) {
    console.error(`Could not parse ${settingsPath}; nothing was changed.\n${err.message}`);
    process.exit(1);
  }
  if (!fs.existsSync(backupPath)) fs.writeFileSync(backupPath, text);
}

const isOurs = h => h && h.type === 'command' && /meanwhile-notify\.js/.test(String(h.command || ''));
const command = `node "${scriptDest.replace(/\\/g, '/')}"`;

const hooks = settings.hooks && typeof settings.hooks === 'object' ? settings.hooks : {};
for (const ev of EVENTS) {
  const groups = (Array.isArray(hooks[ev]) ? hooks[ev] : [])
    .map(g => ({ ...g, hooks: (g.hooks || []).filter(h => !isOurs(h)) }))
    .filter(g => g.hooks.length);
  if (!uninstall) groups.push({ hooks: [{ type: 'command', command, timeout: 5, async: true }] });
  if (groups.length) hooks[ev] = groups; else delete hooks[ev];
}
if (Object.keys(hooks).length) settings.hooks = hooks; else delete settings.hooks;

if (uninstall) {
  if (fs.existsSync(scriptDest)) fs.unlinkSync(scriptDest);
} else {
  fs.mkdirSync(hooksDir, { recursive: true });
  fs.copyFileSync(path.join(__dirname, 'notify.js'), scriptDest);
}
fs.mkdirSync(claudeDir, { recursive: true });
fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');

console.log(uninstall
  ? `Removed the Meanwhile hooks from ${settingsPath}`
  : `Installed the Meanwhile hooks in ${settingsPath}\nHook script: ${scriptDest}\nRestart open Claude Code sessions so they pick the hooks up.`);
