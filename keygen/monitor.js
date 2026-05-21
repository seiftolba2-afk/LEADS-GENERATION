'use strict';
const { spawn } = require('child_process');
const fs        = require('fs');
const path      = require('path');

const ROOT         = __dirname;
const PROJECT_ROOT = path.join(__dirname, '..');
const STOP_FILE = path.join(ROOT, '.keygen.stop');
const LOCK_FILE = path.join(ROOT, '.keygen.lock');

function checkKeyState() {
  try {
    const keys = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'serper_keys.json'), 'utf8'));
    return {
      live:  keys.filter(k => k.status === 'ok').length,
      quota: keys.filter(k => k.status === 'quota').length,
      dead:  keys.filter(k => k.status === 'dead').length,
      total: keys.length,
    };
  } catch { return { live: 0, quota: 0, dead: 0, total: 0 }; }
}

// Remove any stale stop file from a previous session
if (fs.existsSync(STOP_FILE)) fs.unlinkSync(STOP_FILE);
console.log('[Monitor] Running. To stop cleanly after this run: create D:\\LEADS GENERATION\\.keygen.stop');

function shouldStop() {
  return fs.existsSync(STOP_FILE);
}

function cleanup() {
  try { fs.unlinkSync(LOCK_FILE); } catch {}
  try { fs.unlinkSync(STOP_FILE); } catch {}
}

// Ensure cleanup on Ctrl+C or system signal
process.on('SIGINT',  () => { cleanup(); process.exit(0); });
process.on('SIGTERM', () => { cleanup(); process.exit(0); });

async function runKeygen() {
  // Change 6: skip if a fresh lock exists (keygen already running in another process)
  if (fs.existsSync(LOCK_FILE)) {
    const age = Date.now() - fs.statSync(LOCK_FILE).mtimeMs;
    if (age < 120000) {
      console.log('[Monitor] ⚠️  Lock file exists and is fresh (<2 min old) — keygen already running. Skipping this cycle.');
      return 0;
    }
    console.log('[Monitor] Stale lock file (>2 min old) — removing and continuing.');
    try { fs.unlinkSync(LOCK_FILE); } catch {}
  }

  return new Promise((resolve) => {
    console.log('\n[Monitor] Starting key_generator.js...');
    const child = spawn('node', ['agents/key_generator.js'], { stdio: 'inherit', cwd: ROOT });
    child.on('close', (code) => {
      console.log(`\n[Monitor] Script exited with code ${code}.`);
      resolve(code);
    });
  });
}

async function start() {
  let attempts           = 0;
  let consecutiveFailures = 0;

  while (true) {
    // Check stop flag BEFORE starting a new run
    if (shouldStop()) {
      console.log('\n[Monitor] ⛔  Stop file detected — shutting down cleanly.');
      cleanup();
      process.exit(0);
    }

    // Check key state — skip keygen if live keys exist, log clearly if all exhausted
    const state = checkKeyState();
    if (state.live > 0) {
      console.log(`[Monitor] ✅ ${state.live} live key(s) available — no keygen needed. Rechecking in 1h...`);
      await new Promise(r => setTimeout(r, 60 * 60 * 1000));
      continue;
    }
    if (state.total > 0 && state.live === 0) {
      console.log(`[Monitor] ⚠️  All keys exhausted — ${state.quota} quota, ${state.dead} dead. Spawning keygen for fresh account...`);
    } else {
      console.log(`[Monitor] No keys found — spawning keygen...`);
    }

    attempts++;
    console.log(`\n======================================`);
    console.log(`[Monitor] KEYGEN RUN #${attempts}`);
    console.log(`======================================`);

    const exitCode = await runKeygen();

    // Exit code 42 = user manually closed Brave browser → stop entirely
    if (exitCode === 42) {
      console.log('\n[Monitor] 🛑  Browser was closed manually — stopping automation.');
      cleanup();
      process.exit(0);
    }

    // Track consecutive failures — stop after 5 in a row (broken config, not transient)
    if (exitCode !== 0 && exitCode !== 42) {
      consecutiveFailures++;
      if (consecutiveFailures >= 5) {
        console.log('\n[Monitor] ❌ 5 consecutive keygen failures — stopping.');
        console.log('[Monitor]    Check email provider config and VPN, then restart monitor.');
        cleanup();
        process.exit(1);
      }
    } else {
      consecutiveFailures = 0;
    }

    // Check stop flag AFTER the run completes too (stop before restarting)
    if (shouldStop()) {
      console.log('\n[Monitor] ⛔  Stop file detected after run — not restarting.');
      cleanup();
      process.exit(0);
    }

    console.log('[Monitor] Restarting in 5 seconds... (create .keygen.stop to halt)');
    await new Promise(r => setTimeout(r, 5000));
  }
}

start().catch(console.error);
