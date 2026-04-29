'use strict';
// Agent Output — scoring, CSV progress, Excel output, stats sheet

const xlsx = require('xlsx');
const fs   = require('fs');

const HEADERS = [
  'lead_id','source','first_name','last_name','full_name',
  'email','phone','job_title','company_name','company_domain',
  'location_city','location_state','linkedin_url',
  'google_rating','review_count','lead_score','score_reason','name_source','status',
];

// ─────────────────────────────────────────────────────────────
// SCORING
// ─────────────────────────────────────────────────────────────
function scoreLead(lead, nameLayer) {
  let score = 10;
  const reasons = ['Owner name', 'Has phone'];

  if (lead.email)                                         { score += 2; reasons.push('Email found'); }
  if (parseFloat(lead.google_rating) >= 4.5)             { score += 1; reasons.push('Top rated'); }
  if (lead.review_count >= 20 && lead.review_count <= 100) { score += 1; reasons.push('Active reviews'); }
  if (lead.company_domain)                               { score += 1; reasons.push('Has website'); }
  if (lead.review_count >= 50 && lead.review_count <= 100) { score += 1; reasons.push('Sweet spot'); }

  if (nameLayer) {
    const hiConf = ['L4:LicenseDB','L6:OpenCorp','L2a:Website','L2b:EmailPrefix'];
    const loConf = ['L13:Facebook'];
    if (hiConf.includes(nameLayer))        { score += 2; reasons.push('High-conf name'); }
    else if (loConf.includes(nameLayer))   { score -= 1; }
  }
  return { score, reason: reasons.join(', ') };
}

// ─────────────────────────────────────────────────────────────
// CSV PROGRESS
// ─────────────────────────────────────────────────────────────
function csvRow(lead) { return HEADERS.map(h => `"${String(lead[h] ?? '').replace(/"/g,'""')}"`).join(','); }

function initProgressFile(config) {
  fs.writeFileSync(config.PROGRESS_FILE, HEADERS.join(',') + '\n', 'utf8');
}

function appendToProgress(config, lead) {
  try { fs.appendFileSync(config.PROGRESS_FILE, csvRow(lead) + '\n', 'utf8'); }
  catch (e) { console.log(`  ⚠️  CSV write error: ${e.message}`); }
}

function loadProgress(config) {
  if (!fs.existsSync(config.PROGRESS_FILE)) return { leads: [], done: new Set() };
  const lines = fs.readFileSync(config.PROGRESS_FILE, 'utf8').trim().split('\n');
  if (lines.length <= 1) return { leads: [], done: new Set() };
  const hdrs  = lines[0].split(',').map(h => h.replace(/"/g,'').trim());
  const leads = lines.slice(1).map(line => {
    const row = {}; let inQ = false, val = '', col = 0;
    for (const ch of line) {
      if (ch === '"') inQ = !inQ;
      else if (ch === ',' && !inQ) { row[hdrs[col]] = val; val = ''; col++; }
      else val += ch;
    }
    row[hdrs[col]] = val;
    return row;
  });
  return { leads, done: new Set(leads.map(l => (l.company_name || '').toLowerCase().trim())) };
}

// ─────────────────────────────────────────────────────────────
// EXCEL OUTPUT
// ─────────────────────────────────────────────────────────────
function toSheet(rows) {
  const ws = xlsx.utils.json_to_sheet(rows, { header: HEADERS });
  if (!ws['!ref']) return ws;
  const range = xlsx.utils.decode_range(ws['!ref']);

  ws['!cols'] = HEADERS.map(h => {
    const widths = { company_name: 30, full_name: 22, email: 28, company_domain: 28, score_reason: 40, name_source: 18 };
    return { wch: widths[h] || 14 };
  });
  ws['!autofilter'] = { ref: ws['!ref'] };

  let pCol = -1, dCol = -1;
  for (let C = range.s.c; C <= range.e.c; C++) {
    const cell = ws[xlsx.utils.encode_cell({ r: 0, c: C })];
    if (cell?.v === 'phone')          pCol = C;
    if (cell?.v === 'company_domain') dCol = C;
  }
  for (let R = 1; R <= range.e.r; R++) {
    if (pCol !== -1) {
      const a = xlsx.utils.encode_cell({ r: R, c: pCol });
      if (ws[a]) { ws[a].t = 's'; ws[a].v = String(ws[a].v); ws[a].z = '@'; }
    }
    if (dCol !== -1) {
      const a = xlsx.utils.encode_cell({ r: R, c: dCol });
      if (ws[a] && ws[a].v) ws[a].l = { Target: `https://${ws[a].v}`, Tooltip: ws[a].v };
    }
  }
  return ws;
}

function buildStatsSheet(allLeads, hotLeads, industry) {
  const all    = [...allLeads, ...hotLeads];
  const named  = all.filter(l => l.full_name).length;
  const emailed = all.filter(l => l.email).length;
  const avgScore = all.length ? (all.reduce((s, l) => s + (parseFloat(l.lead_score) || 0), 0) / all.length).toFixed(1) : 0;
  const byCities = {};
  all.forEach(l => { byCities[l.location_city] = (byCities[l.location_city] || 0) + 1; });
  const topCities = Object.entries(byCities).sort((a,b) => b[1]-a[1]).slice(0,10);

  const rows = [
    { Metric: `${industry} Lead Run`, Value: new Date().toLocaleDateString() },
    { Metric: 'Hot Leads',            Value: hotLeads.length },
    { Metric: 'All Leads',            Value: allLeads.length },
    { Metric: 'Total',                Value: all.length },
    { Metric: 'With Owner Name',      Value: named },
    { Metric: 'Name Hit Rate',        Value: all.length ? `${Math.round(named/all.length*100)}%` : '0%' },
    { Metric: 'With Email',           Value: emailed },
    { Metric: 'Email Rate',           Value: all.length ? `${Math.round(emailed/all.length*100)}%` : '0%' },
    { Metric: 'Avg Lead Score',       Value: avgScore },
    { Metric: '', Value: '' },
    { Metric: 'Top Cities', Value: 'Count' },
    ...topCities.map(([c, n]) => ({ Metric: c, Value: n })),
  ];
  return xlsx.utils.json_to_sheet(rows, { header: ['Metric','Value'] });
}

function saveExcel(config, allLeads, hotLeads) {
  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, toSheet(hotLeads), 'Hot Leads');
  xlsx.utils.book_append_sheet(wb, toSheet(allLeads), 'All Leads');
  xlsx.utils.book_append_sheet(wb, buildStatsSheet(allLeads, hotLeads, config.INDUSTRY_NAME), 'Stats');
  try {
    xlsx.writeFile(wb, config.OUTPUT_FILE);
    console.log(`\n✅ Saved → ${config.OUTPUT_FILE}`);
    console.log(`   Hot Leads : ${hotLeads.length} | All Leads : ${allLeads.length} | Total : ${hotLeads.length + allLeads.length}`);
  } catch (e) {
    if (e.code === 'EBUSY') console.error(`\n❌ Close the Excel file first, then run again.`);
    else console.error(`\n❌ Save error: ${e.message}`);
  }
}

module.exports = { scoreLead, saveExcel, toSheet, buildStatsSheet, initProgressFile, appendToProgress, loadProgress, HEADERS };
