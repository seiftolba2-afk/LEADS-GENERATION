const http   = require('http');
const { spawn, exec } = require('child_process');
const path   = require('path');
const fs     = require('fs');

const PORT = 3131;
const BASE = 'D:\\LEADS GENERATION';

let sseClients    = [];
let currentProc   = null;
let isRunning     = false;
let lastIndustry  = 'roofing';
let lastCount     = 300;

function broadcast(msg) {
  const data = `data: ${JSON.stringify(msg)}\n\n`;
  sseClients = sseClients.filter(c => {
    try { c.write(data); return true; } catch { return false; }
  });
}

// ─── HTML UI ──────────────────────────────────────────────────
const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Lead Generator</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:#0d1117;color:#e6edf3;font-family:'Segoe UI',system-ui,sans-serif;min-height:100vh;display:flex;flex-direction:column;align-items:center;padding:32px 16px}
  h1{font-size:22px;font-weight:700;letter-spacing:.5px;margin-bottom:28px;color:#f0f6fc}
  h1 span{color:#58a6ff}
  .card{background:#161b22;border:1px solid #30363d;border-radius:12px;padding:28px;width:100%;max-width:760px;margin-bottom:20px}
  .row{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:18px}
  .row:last-child{margin-bottom:0}
  label{font-size:13px;color:#8b949e;min-width:80px}
  .tabs{display:flex;gap:8px}
  .tab{padding:8px 20px;border-radius:8px;border:1px solid #30363d;background:#0d1117;color:#8b949e;cursor:pointer;font-size:14px;font-weight:500;transition:all .15s}
  .tab.active{background:#1f6feb;border-color:#1f6feb;color:#fff}
  .tab:hover:not(.active){border-color:#58a6ff;color:#58a6ff}
  input[type=number]{background:#0d1117;border:1px solid #30363d;color:#e6edf3;border-radius:8px;padding:8px 14px;font-size:14px;width:110px;outline:none}
  input[type=number]:focus{border-color:#58a6ff}
  .btns{display:flex;gap:10px}
  button{padding:9px 22px;border-radius:8px;border:none;font-size:14px;font-weight:600;cursor:pointer;transition:all .15s}
  #btnRun{background:#238636;color:#fff}
  #btnRun:hover:not(:disabled){background:#2ea043}
  #btnRun:disabled{background:#21262d;color:#484f58;cursor:not-allowed}
  #btnStop{background:#da3633;color:#fff;display:none}
  #btnStop:hover{background:#f85149}
  #btnOpen{background:#1f6feb;color:#fff;display:none}
  #btnOpen:hover{background:#388bfd}
  .log-wrap{background:#010409;border:1px solid #21262d;border-radius:8px;height:340px;overflow-y:auto;padding:14px 16px;font-family:'Cascadia Code','Consolas','Courier New',monospace;font-size:12.5px;line-height:1.6}
  .log-wrap p{margin:0;white-space:pre-wrap;word-break:break-all}
  .ok{color:#3fb950}
  .fail{color:#f85149}
  .info{color:#58a6ff}
  .dim{color:#484f58}
  .chk{color:#e3b341}
  .bar-wrap{margin-top:14px;background:#21262d;border-radius:6px;height:8px;overflow:hidden;display:none}
  .bar{height:100%;background:#238636;width:0%;transition:width .4s}
  .status{font-size:13px;color:#8b949e;margin-top:8px;min-height:20px}
  .done-banner{display:none;background:#0f2918;border:1px solid #238636;border-radius:8px;padding:14px 18px;color:#3fb950;font-size:14px;font-weight:600;align-items:center;gap:14px}
  .done-banner.show{display:flex}
</style>
</head>
<body>
<h1>🏠 <span>Lead Generator</span></h1>

<div class="card">
  <div class="row">
    <label>Industry</label>
    <div class="tabs">
      <div class="tab active" data-ind="roofing">🏠 Roofing</div>
      <div class="tab" data-ind="solar">☀️ Solar</div>
      <div class="tab" data-ind="hvac">❄️ HVAC</div>
    </div>
  </div>
  <div class="row">
    <label>Leads</label>
    <input type="number" id="count" value="300" min="10" max="900" step="10">
    <span style="font-size:12px;color:#484f58">max 900</span>
  </div>
  <div class="row">
    <div class="btns">
      <button id="btnRun">▶ Generate Leads</button>
      <button id="btnStop">⏹ Stop</button>
      <button id="btnOpen">📂 Open Excel File</button>
    </div>
  </div>
</div>

<div class="card">
  <div id="logBox" class="log-wrap"><p class="dim">Output will appear here when you start a run...</p></div>
  <div class="bar-wrap" id="barWrap"><div class="bar" id="bar"></div></div>
  <div class="status" id="status"></div>
</div>

<div class="done-banner" id="doneBanner">
  ✅ Run complete! File saved to D:\\LEADS GENERATION
</div>

<script>
let industry = 'roofing';
let es = null;
let found = 0, target = 300;

document.querySelectorAll('.tab').forEach(t => {
  t.onclick = () => {
    document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    industry = t.dataset.ind;
  };
});

function log(text, cls) {
  const box = document.getElementById('logBox');
  const p = document.createElement('p');
  p.textContent = text;
  if (cls) p.className = cls;
  box.appendChild(p);
  box.scrollTop = box.scrollHeight;
}

function classFor(line) {
  if (line.includes('✅') && !line.includes('Saved')) return 'ok';
  if (line.includes('⛔') || line.includes('⚠️') || line.includes('❌')) return 'fail';
  if (line.includes('💾') || line.includes('Checkpoint')) return 'chk';
  if (line.includes('[Maps]') || line.includes('📍') || line.includes('🔍') || line.includes('🚀')) return 'info';
  return '';
}

function setRunning(on) {
  document.getElementById('btnRun').disabled = on;
  document.getElementById('btnStop').style.display = on ? 'inline-block' : 'none';
  document.getElementById('barWrap').style.display = on ? 'block' : 'block';
}

function updateProgress(line) {
  // Parse "[  45/300]" or "45/300"
  const m = line.match(/\[?\s*(\d+)\s*\/\s*(\d+)\]?/);
  if (m) {
    const cur = parseInt(m[1]), tot = parseInt(m[2]);
    if (tot > 10) {
      target = tot;
      document.getElementById('bar').style.width = Math.min(100, Math.round(cur/tot*100)) + '%';
      document.getElementById('status').textContent = \`Processing \${cur} of \${tot} leads...\`;
    }
  }
  // Count named leads from "— X/Y" pattern
  const n = line.match(/— (\d+)\/(\d+)\s*$/);
  if (n) {
    found = parseInt(n[1]);
    target = parseInt(n[2]);
    document.getElementById('bar').style.width = Math.min(100, Math.round(found/target*100)) + '%';
    document.getElementById('status').textContent = \`\${found} of \${target} named leads found\`;
  }
}

document.getElementById('btnRun').onclick = async () => {
  found = 0; target = parseInt(document.getElementById('count').value);
  const box = document.getElementById('logBox');
  box.innerHTML = '';
  document.getElementById('doneBanner').classList.remove('show');
  document.getElementById('btnOpen').style.display = 'none';
  document.getElementById('status').textContent = 'Starting...';
  document.getElementById('bar').style.width = '0%';
  setRunning(true);

  // Connect SSE FIRST so we don't miss early output
  if (es) es.close();
  es = new EventSource('/stream');
  es.onmessage = e => {
    const msg = JSON.parse(e.data);
    if (msg.startsWith('__DONE__')) {
      const parts = msg.split(':');
      const ind = parts[1], cnt = parts[2];
      setRunning(false);
      es.close();
      document.getElementById('status').textContent = \`✅ Done — \${cnt} leads saved\`;
      document.getElementById('bar').style.width = '100%';
      document.getElementById('doneBanner').classList.add('show');
      document.getElementById('btnOpen').style.display = 'inline-block';
      document.getElementById('btnOpen').dataset.industry = ind;
      document.getElementById('btnOpen').dataset.count = cnt;
      return;
    }
    const lines = msg.split('\\n');
    lines.forEach(line => {
      if (line.trim()) {
        log(line, classFor(line));
        updateProgress(line);
      }
    });
  };

  // Start the run AFTER SSE is connected
  try {
    const r = await fetch('/run', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ industry, count: target })
    });
    if (!r.ok) { log('Error: ' + await r.text(), 'fail'); setRunning(false); }
  } catch(err) { log('Connection error: ' + err.message, 'fail'); setRunning(false); }
};

document.getElementById('btnStop').onclick = async () => {
  await fetch('/stop', { method: 'POST' });
  if (es) es.close();
  setRunning(false);
  document.getElementById('status').textContent = 'Stopped.';
};

document.getElementById('btnOpen').onclick = () => {
  const btn = document.getElementById('btnOpen');
  fetch(\`/open?industry=\${btn.dataset.industry}&count=\${btn.dataset.count}\`);
};
</script>
</body>
</html>`;

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
      const { industry, count } = JSON.parse(body);
      lastIndustry = industry;
      lastCount    = count;
      isRunning    = true;

      broadcast(`🚀  Starting: ${count} ${industry} leads...\n`);

      currentProc = spawn('node', [path.join(BASE, 'leads.js'), String(count), industry], {
        cwd: BASE,
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
    const ind = params.get('industry') || lastIndustry;
    const cnt = params.get('count')    || lastCount;
    const file = path.join(BASE, `leads_${cnt}_${ind}.xlsx`);
    if (!fs.existsSync(file)) { res.writeHead(404); res.end('File not found'); return; }
    const data = fs.readFileSync(file);
    const filename = `leads_${cnt}_${ind}.xlsx`;
    res.writeHead(200, {
      'Content-Type':        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length':      data.length,
    });
    res.end(data);
    return;
  }

  if (req.method === 'GET' && url === '/open') {
    const params = new URL(req.url, `http://localhost:${PORT}`).searchParams;
    const ind = params.get('industry') || lastIndustry;
    const cnt = params.get('count')    || lastCount;
    const file = `${BASE}\\leads_${cnt}_${ind}.xlsx`;
    exec(`start "" "${file}"`);
    res.writeHead(200); res.end('ok');
    return;
  }

  res.writeHead(404); res.end('not found');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Lead Generator running → http://localhost:${PORT}`);
  exec(`start http://localhost:${PORT}`);
});
