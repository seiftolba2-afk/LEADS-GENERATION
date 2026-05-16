'use strict';
/**
 * @deprecated Replaced by agents/windscribe_manager.js (2026-05).
 * Tor exit IPs trigger CF Turnstile image challenges, so Chrome cannot route through them.
 * This file is retained as a standby fallback only — not imported by key_generator.js anymore.
 */
const { spawn } = require('child_process');
const net  = require('net');
const path = require('path');

const TOR_EXE    = path.join('D:\\LEADS GENERATION', 'tor', 'tor', 'tor.exe');
const TORRC      = path.join('D:\\LEADS GENERATION', 'tor', 'torrc');
const SOCKS_PORT = 9050;
const CTRL_PORT  = 9051;

let torProc = null;
let ready   = false;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function isTorRunning() {
  return new Promise(resolve => {
    const sock = net.connect(CTRL_PORT, '127.0.0.1', () => { sock.destroy(); resolve(true); });
    sock.on('error', () => resolve(false));
    setTimeout(() => { sock.destroy(); resolve(false); }, 2000);
  });
}

async function startTor() {
  if (torProc) return;
  // If another process already has the ports, treat as ready
  if (await isTorRunning()) {
    ready = true;
    console.log('[Tor] Already running on port 9051 — skipping start');
    return;
  }
  console.log('[Tor] Starting daemon...');
  torProc = spawn(TOR_EXE, ['-f', TORRC], { stdio: ['ignore', 'pipe', 'pipe'] });

  torProc.stdout.on('data', d => {
    const line = d.toString().trim();
    if (line.includes('Bootstrapped 100%')) { ready = true; console.log('[Tor] Ready — 100% bootstrapped'); }
    else if (line.includes('Bootstrapped')) console.log('[Tor]', line.match(/Bootstrapped \d+%[^)]+\)/)?.[0] || line.slice(0, 80));
  });
  torProc.stderr.on('data', d => process.stderr.write('[Tor ERR] ' + d));
  torProc.on('exit', () => { torProc = null; ready = false; console.log('[Tor] Process exited'); });

  // Wait up to 90s for bootstrap
  for (let i = 0; i < 90; i++) {
    if (ready) return;
    await sleep(1000);
  }
  if (!ready) throw new Error('[Tor] Bootstrap timeout after 90s');
}

async function sendControl(cmd) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(CTRL_PORT, '127.0.0.1', () => {
      sock.write(`AUTHENTICATE ""\r\n${cmd}\r\nQUIT\r\n`);
    });
    let buf = '';
    sock.on('data', d => { buf += d.toString(); });
    sock.on('close', () => resolve(buf));
    sock.on('error', reject);
    setTimeout(() => { sock.destroy(); resolve(buf); }, 5000);
  });
}

// Request a fresh Tor circuit (new exit IP). Takes ~5s to propagate.
async function renewCircuit() {
  console.log('[Tor] Requesting new circuit (NEWNYM)...');
  const res = await sendControl('SIGNAL NEWNYM').catch(e => {
    console.log('[Tor] Control error:', e.message);
    return '';
  });
  if (res.includes('250')) console.log('[Tor] New circuit granted');
  else console.log('[Tor] NEWNYM response:', res.slice(0, 100));
  await sleep(6000); // Tor enforces min 10s between NEWNYMs — we respect it
}

async function stopTor() {
  if (torProc) { torProc.kill(); torProc = null; ready = false; }
}

function isReady() { return ready; }
function getSocksProxy() { return `socks5://127.0.0.1:${SOCKS_PORT}`; }
function getSocksArg()   { return `socks5://127.0.0.1:${SOCKS_PORT}`; }

module.exports = { startTor, stopTor, renewCircuit, isReady, getSocksProxy, getSocksArg, SOCKS_PORT };
