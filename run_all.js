'use strict';
// Cross-platform alternative to run_all.bat
// Usage: node run_all.js

const { execSync } = require('child_process');
const fs   = require('fs');
const path = require('path');

const BASE = 'D:\\LEADS GENERATION';
const LOG  = path.join(BASE, 'tasks', 'run_log.txt');

const industries = [
  'local_aggregator.js',
  'solar_aggregator.js',
  'hvac_aggregator.js',
  'plumbing_aggregator.js',
  'electrical_aggregator.js',
  'landscaping_aggregator.js',
  'painting_aggregator.js',
  'general_contracting_aggregator.js',
];

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(LOG, line + '\n'); } catch {}
}

log('=== Run started ===');
log(`Industries: ${industries.length}`);

for (let i = 0; i < industries.length; i++) {
  const script = industries[i];
  log(`[${i+1}/${industries.length}] Starting ${script}...`);
  try {
    execSync(`node "${path.join(BASE, script)}"`, { stdio: 'inherit', cwd: BASE });
    log(`[${i+1}/${industries.length}] Done: ${script}`);
  } catch (e) {
    log(`[${i+1}/${industries.length}] ERROR: ${script} — ${e.message}`);
    // Continue with next industry — one crash doesn't stop the run
  }
}

log('=== Run finished ===');

// Pushover notification (silent skip when keys missing)
const pushUser  = process.env.PUSHOVER_USER_KEY;
const pushToken = process.env.PUSHOVER_API_TOKEN;
if (pushUser && pushToken) {
  fetch('https://api.pushover.net/1/messages.json', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ token: pushToken, user: pushUser, title: 'Lead Run Complete', message: `All ${industries.length} industries finished.` }),
  }).then(r => log(`Pushover: ${r.status}`)).catch(e => log(`Pushover failed: ${e.message}`));
}
