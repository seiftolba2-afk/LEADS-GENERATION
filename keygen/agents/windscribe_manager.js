'use strict';
/**
 * windscribe_manager.js — Windscribe VPN CLI wrapper (OS-level routing)
 *
 * IMPORTANT — Effect on system traffic:
 *   When connected, Windscribe routes ALL OS traffic through the VPN.
 *   This means your regular browser tabs also see the VPN IP while keygen runs.
 *   The VPN is disconnected automatically at the end of each run, so disruption
 *   is limited to the duration of one key generation attempt (~2-4 min).
 *
 *   Windscribe "ip rotate" (per-connection IP change without disconnect) requires
 *   a Pro subscription. The proxy-gateway feature does not exist in CLI v2.21.7.
 *   Until a Pro account is available, OS-level routing is the only free option.
 *
 * ⚠  FIRST-TIME SETUP (manual, one time only):
 *   1. Run "D:\LEADS GENERATION\windscribe_setup.exe" and install Windscribe. ✅
 *   2. Log in via the Windscribe GUI. ✅
 *
 * If Windscribe is not installed, all functions become safe no-ops.
 */

const { execSync } = require('child_process');

const WS_CLI = '"C:\\Program Files\\Windscribe\\windscribe-cli.exe"';

// US locations prioritised — Serper is a US service, US exit IPs get better
// reCAPTCHA treatment than EU exits.
const LOCATIONS = [
  'US Central',
  'US East',
  'US West',
  'CA Central',
  'CA East',
  'US Central',
  'US East',
  'US West',
];

let _locationIdx = 0;
let _ready       = false;

// ── Availability check ───────────────────────────────────────────────────────
let _available = false;
try {
  execSync(`${WS_CLI} --version`, { encoding: 'utf8', timeout: 5000, windowsHide: true, stdio: 'pipe' });
  _available = true;
} catch {
  console.warn(
    '\n⚠️  [Windscribe] CLI not found.\n' +
    '   Install: D:\\LEADS GENERATION\\windscribe_setup.exe\n' +
    '   Keygen will run WITHOUT IP rotation until Windscribe is installed.\n'
  );
}

if (!_available) {
  const noop = async () => {};
  module.exports = {
    connect: noop, rotate: noop, disconnect: noop,
    startTor: noop, renewCircuit: noop, stopTor: noop,
    isReady: () => false, isAvailable: () => false,
    getSocksProxy: () => '', getSocksArg: () => '',
    getProxyUrl: () => '', getProxyArg: () => '',
    PROXY_URL: '', SOCKS_PORT: 0,
  };
  return;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function wsRun(args, timeoutMs = 25000) {
  try {
    return execSync(`${WS_CLI} ${args}`, {
      encoding: 'utf8',
      timeout: timeoutMs,
      windowsHide: true,
    }).trim();
  } catch (e) {
    return (e.stdout || '') + (e.stderr || '') || e.message;
  }
}

async function connectTo(location) {
  console.log(`[Windscribe] Connecting to "${location}"...`);
  const out = wsRun(`connect "${location}"`, 30000);
  const lower = out.toLowerCase();
  console.log(`[Windscribe] connect output: ${out.slice(0, 120)}`);

  // Check "already" FIRST — "Already connected to X" contains the substring "connected"
  // so the naive includes('connected') branch would silently no-op the rotation.
  if (lower.includes('already')) {
    wsRun('disconnect', 10000);
    await sleep(2000);
    const out2 = wsRun(`connect "${location}"`, 30000);
    const lower2 = out2.toLowerCase();
    if (lower2.includes('connected') && !lower2.includes('already')) {
      _ready = true;
      console.log(`[Windscribe] ✅ Reconnected — ${location}`);
      return true;
    }
    console.log(`[Windscribe] ⚠️  Reconnect failed: ${out2.slice(0, 120)}`);
    return false;
  }

  if (lower.includes('connected')) {
    _ready = true;
    console.log(`[Windscribe] ✅ Connected — ${location}`);
    return true;
  }

  // Surface SSL / login errors so the caller can see why connection failed
  if (lower.includes('ssl') || lower.includes('login') || lower.includes('not logged')) {
    console.log(`[Windscribe] ❌ Auth error — please log in via the Windscribe GUI: ${out.slice(0, 120)}`);
  }

  console.log(`[Windscribe] ⚠️  Could not connect to ${location}`);
  return false;
}

// Poll Windscribe status until connected or timeout — confirms tunnel + CLI agree
async function pollConnected(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const s = wsRun('status', 8000).toLowerCase();
    if (s.includes('connected')) { _ready = true; return true; }
    await sleep(2000);
  }
  return false;
}

async function startTor() {
  const status = wsRun('status', 8000);
  if (status.toLowerCase().includes('connected')) {
    console.log('[Windscribe] Already connected — disconnecting to rotate to fresh IP...');
    wsRun('disconnect', 10000);
    await sleep(2000);
  }
  for (let i = 0; i < LOCATIONS.length; i++) {
    const loc = LOCATIONS[_locationIdx % LOCATIONS.length];
    _locationIdx++;
    const ok = await connectTo(loc);
    if (ok) {
      // Verify tunnel is stable before returning (prevents ERR_NAME_NOT_RESOLVED)
      console.log(`[Windscribe] Verifying tunnel stability for ${loc} (up to 20s)...`);
      const confirmed = await pollConnected(20000);
      if (!confirmed) {
        console.log(`[Windscribe] ⚠️  Tunnel not confirmed for ${loc} — trying next location...`);
        wsRun('disconnect', 8000); // clean up before retrying
        await sleep(1500);
        continue;
      }
      await sleep(3000); // extra settle time for DNS propagation
      return;
    }
    await sleep(2000);
  }
  console.log('[Windscribe] All named locations failed — trying Best Location...');
  const out = wsRun('connect best', 30000);
  if (out.toLowerCase().includes('connected')) {
    _ready = true;
    console.log('[Windscribe] ✅ Connected to Best Location');
    const confirmed = await pollConnected(30000);
    if (!confirmed) {
      console.log('[Windscribe] ❌ Best Location tunnel not confirmed — running without VPN');
      _ready = false;
    } else {
      await sleep(3000);
    }
  } else {
    console.log('[Windscribe] ❌ Could not connect — running without IP rotation');
  }
}

async function renewCircuit() {
  const location = LOCATIONS[_locationIdx % LOCATIONS.length];
  _locationIdx++;
  console.log(`[Windscribe] Rotating IP → "${location}"...`);

  // Try connecting to new location first — only disconnect if it works
  // This prevents leaving the browser without internet if the new connection fails
  const ok = await connectTo(location);
  if (ok) {
    _ready = true;
    await sleep(3000);
    return;
  }

  // New location failed — try best location without disconnecting first
  const fallbackOut = wsRun('connect best', 30000);
  if (fallbackOut.toLowerCase().includes('connected')) {
    _ready = true;
    console.log('[Windscribe] ✅ Fallback connected to Best Location');
    await sleep(3000);
    return;
  }

  // Everything failed — keep existing connection alive, don't disconnect
  console.log('[Windscribe] ⚠️  Rotation failed — keeping current connection');
  await sleep(2000);
}

const rotate = renewCircuit;

async function stopTor() {
  _ready = false;
  const out = wsRun('disconnect', 10000);
  console.log(`[Windscribe] Disconnected: ${out.slice(0, 80)}`);
}

function isReady()       { return _ready; }
function isAvailable()   { return _available; }
function getProxyUrl()   { return ''; }  // no proxy — OS routing
function getProxyArg()   { return ''; }
function getSocksProxy() { return ''; }
function getSocksArg()   { return ''; }

module.exports = {
  connect: startTor,
  rotate,
  disconnect: stopTor,
  startTor,
  renewCircuit,
  stopTor,
  pollConnected,
  isReady,
  isAvailable,
  getProxyUrl,
  getProxyArg,
  getSocksProxy,
  getSocksArg,
  PROXY_URL: '',
  SOCKS_PORT: 0,
};
