const http   = require('http');
const { spawn, exec } = require('child_process');
const path   = require('path');
const fs     = require('fs');

const PORT = 3131;
const BASE = 'D:\\LEADS GENERATION';

const SCRIPT_MAP = {
  roofing:     'local_aggregator.js',
  solar:       'solar_aggregator.js',
  hvac:        'hvac_aggregator.js',
  electrical:  'electrical_aggregator.js',
  plumbing:    'plumbing_aggregator.js',
  painting:    'painting_aggregator.js',
  landscaping: 'landscaping_aggregator.js',
  general:     'general_contracting_aggregator.js',
};

const OUTPUT_MAP = {
  roofing:     path.join('out', 'Roofing.xlsx'),
  solar:       path.join('out', 'Solar.xlsx'),
  hvac:        path.join('out', 'HVAC.xlsx'),
  electrical:  path.join('out', 'Electrical.xlsx'),
  plumbing:    path.join('out', 'Plumbing.xlsx'),
  painting:    path.join('out', 'Painting.xlsx'),
  landscaping: path.join('out', 'Landscaping.xlsx'),
  general:     path.join('out', 'General.xlsx'),
};

let sseClients    = [];
let currentProc   = null;
let isRunning     = false;
let lastIndustry  = 'roofing';
let lastCount     = 100;

function broadcast(msg) {
  const data = `data: ${JSON.stringify(msg)}\n\n`;
  sseClients = sseClients.filter(c => {
    try { c.write(data); return true; } catch { return false; }
  });
}

// ─── SERVER ───────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];

  if (req.method === 'GET' && url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(fs.readFileSync(path.join(BASE, 'app.html')));
    return;
  }

  if (req.method === 'GET' && url === '/stream') {
    res.writeHead(200, {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection':    'keep-alive',
    });
    res.write(':\n\n');
    sseClients.push(res);
    req.on('close', () => { sseClients = sseClients.filter(c => c !== res); });
    return;
  }

  if (req.method === 'POST' && url === '/run') {
    if (isRunning) { res.writeHead(409); res.end('already running'); return; }
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      let industry, count, batchName;
      try { ({ industry, count, batchName } = JSON.parse(body)); }
      catch { res.writeHead(400); res.end('bad json'); return; }
      lastIndustry = industry;
      lastCount    = count;
      isRunning    = true;

      const script = SCRIPT_MAP[industry] || 'local_aggregator.js';
      broadcast(`🚀  Starting: ${count} ${industry} leads...\n`);

      currentProc = spawn('node', [path.join(BASE, script)], {
        cwd: BASE,
        env: { ...process.env, LEAD_TOTAL: String(count), BATCH_NAME: batchName || '' },
      });

      currentProc.stdout.on('data', d => broadcast(d.toString()));
      currentProc.stderr.on('data', d => broadcast('⚠️  ' + d.toString()));
      currentProc.on('close', () => {
        isRunning = false;
        broadcast(`__DONE__:${industry}:${count}`);
      });

      res.writeHead(200); res.end('started');
    });
    return;
  }

  if (req.method === 'POST' && url === '/stop') {
    if (currentProc) { currentProc.kill(); currentProc = null; }
    isRunning = false;
    broadcast('\n⛔ Stopped by user.\n');
    res.writeHead(200); res.end('stopped');
    return;
  }

  if (req.method === 'POST' && url === '/reset') {
    if (currentProc) { try { currentProc.kill(); } catch(e) {} currentProc = null; }
    isRunning = false;
    res.writeHead(200); res.end('reset');
    return;
  }

  if (req.method === 'GET' && url === '/download') {
    const params = new URL(req.url, `http://localhost:${PORT}`).searchParams;
    const ind  = params.get('industry') || lastIndustry;
    const name = OUTPUT_MAP[ind] || 'SAMPLE.xlsx';
    const file = path.join(BASE, name);
    if (!fs.existsSync(file)) { res.writeHead(404); res.end('File not found'); return; }
    const data = fs.readFileSync(file);
    res.writeHead(200, {
      'Content-Type':        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${name}"`,
      'Content-Length':      data.length,
    });
    res.end(data);
    return;
  }

  if (req.method === 'GET' && url === '/open') {
    const params = new URL(req.url, `http://localhost:${PORT}`).searchParams;
    const ind  = params.get('industry') || lastIndustry;
    const file = path.join(BASE, OUTPUT_MAP[ind] || path.join('out', 'Roofing.xlsx'));
    exec(`start "" "${file}"`);
    res.writeHead(200); res.end('ok');
    return;
  }

  if (req.method === 'POST' && url === '/whop') {
    const whopScript = path.join(BASE, 'whop_list.js');
    if (!require('fs').existsSync(whopScript)) {
      res.writeHead(404); res.end('whop_list.js not found');
      return;
    }
    require('child_process').exec(`start cmd /k "cd /d "${BASE}" && node whop_list.js"`);
    res.writeHead(200); res.end('launched');
    return;
  }

  res.writeHead(404); res.end('not found');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Lead Generator running → http://localhost:${PORT}`);
  exec(`start http://localhost:${PORT}`);
});
