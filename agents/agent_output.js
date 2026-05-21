'use strict';
// Agent Output — scoring, DB/CSV progress, Excel output, stats sheet

const xlsx = require('xlsx');
const fs   = require('fs');
const path = require('path');
const { loadLeadsProgress, appendLead, clearProgress } = require('../db');

const HEADERS = [
  'lead_id','source','first_name','last_name','full_name',
  'email','phone','phone_type','job_title','company_name','company_domain',
  'location_city','location_state','linkedin_url','facebook_followers',
  'instagram_handle','instagram_followers','instagram_bio','instagram_posts',
  'google_rating','review_count','lead_score','score_reason','name_source','status','scraped_date',
  'trigger_signal','domain_age_days','review_velocity','completeness_pct',
];

// ─────────────────────────────────────────────────────────────
// SCORING
// ─────────────────────────────────────────────────────────────
function scoreLead(lead, nameLayer) {
  let score = 10;
  const reasons = ['Owner name', 'Has phone'];

  if (lead.source === 'facebook')      { score += 3; reasons.push('FB-sourced'); }
  else if (lead.source === 'linkedin') { score += 1; reasons.push('LI-sourced'); }

  if (lead.email)                                         { score += 2; reasons.push('Email found'); }
  if (parseFloat(lead.google_rating) >= 4.5)             { score += 1; reasons.push('Top rated'); }
  if (lead.review_count >= 20 && lead.review_count <= 100) { score += 1; reasons.push('Active reviews'); }
  if (lead.company_domain)                               { score += 1; reasons.push('Has website'); }
  if (lead.review_count >= 50 && lead.review_count <= 100) { score += 1; reasons.push('Sweet spot'); }

  if (nameLayer) {
    const hiConf = ['L4:LicenseDB','L6:OpenCorp','L2a:Website','L2b:EmailPrefix','L2f:InstagramBio'];
    const loConf = ['L13:Facebook'];
    if (hiConf.includes(nameLayer))        { score += 2; reasons.push('High-conf name'); }
    else if (loConf.includes(nameLayer))   { score -= 1; }
  }

  const fb = (lead.facebook_followers !== null && lead.facebook_followers !== undefined)
    ? parseInt(lead.facebook_followers) : -1;
  if (fb >= 0 && fb < 200)         { score += 2; reasons.push('Micro-biz FB'); }
  else if (fb >= 200 && fb <= 1000) { score += 1; reasons.push('Small FB'); }

  if (lead.linkedin_url) { score += 1; reasons.push('LinkedIn found'); }

  // 1. Instagram handle exists (+3)
  if (lead.instagram_handle) {
    score += 3;
    reasons.push('Instagram handle found');
  }

  // 2. High followers (+2)
  if (parseInt(lead.instagram_followers) >= 1000) {
    score += 2;
    reasons.push('High Instagram followers');
  }

  // 3. Arabic owner name (+1)
  const isArabic = /[\u0600-\u06FF]/.test(lead.full_name || '');
  if (isArabic) {
    score += 1;
    reasons.push('Arabic owner name');
  }

  // 4. Egyptian mobile direct line (+3)
  if (lead.phone_type === 'mobile') {
    score += 3;
    reasons.push('Egyptian mobile direct');
  } else if (lead.phone_type === 'landline') {
    score -= 1;
    reasons.push('Landline');
  }

  return { score, reason: reasons.join(', ') };
}

// ─────────────────────────────────────────────────────────────
// DB PROGRESS (replaces CSV)
// ─────────────────────────────────────────────────────────────
function initProgressFile(config) {
  clearProgress(config.INDUSTRY_ID);
}

function appendToProgress(config, lead) {
  try { appendLead(config.INDUSTRY_ID, lead); }
  catch (e) { console.log(`  ⚠️  DB write error: ${e.message}`); }
}

function loadProgress(config) {
  return loadLeadsProgress(config.INDUSTRY_ID);
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

  const mobile   = all.filter(l => l.phone_type === 'mobile').length;
  const landline = all.filter(l => l.phone_type === 'landline').length;
  const verified = all.filter(l => l.phone_type).length;

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
    { Metric: 'Phone Verified',       Value: verified },
    { Metric: 'Mobile',               Value: mobile },
    { Metric: 'Landline',             Value: landline },
    { Metric: 'Mobile Rate',          Value: verified ? `${Math.round(mobile/verified*100)}%` : 'N/A' },
    { Metric: '', Value: '' },
    { Metric: 'Top Cities', Value: 'Count' },
    ...topCities.map(([c, n]) => ({ Metric: c, Value: n })),
  ];
  return xlsx.utils.json_to_sheet(rows, { header: ['Metric','Value'] });
}

function saveManualReview(config, leads) {
  if (!leads || !leads.length) return;
  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, toSheet(leads), 'Manual Review');
  const file = config.OUTPUT_FILE.replace('.xlsx', '_manual_review.xlsx');
  try {
    xlsx.writeFile(wb, file);
    console.log(`📋 Manual review → ${file} (${leads.length} leads with phone but no name)`);
  } catch (e) {
    if (e.code === 'EBUSY') console.error(`❌ Close the manual review file first.`);
    else console.error(`❌ Manual review save error: ${e.message}`);
  }
}

function saveExcel(config, allLeads, hotLeads, sheetName) {
  const dir = path.dirname(config.OUTPUT_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const combined = [...hotLeads, ...allLeads];
  combined.sort((a, b) => (b.lead_score || 0) - (a.lead_score || 0));

  let finalLeads;
  if (config.PHONE_QUOTAS) {
    const QM = config.PHONE_QUOTAS.mobile   ?? 200;
    const QV = config.PHONE_QUOTAS.voip     ?? 100;
    const QL = config.PHONE_QUOTAS.landline  ?? 100;

    const wireless = combined.filter(l => l.phone_type === 'mobile').slice(0, QM);
    const voip     = combined.filter(l => l.phone_type === 'voip').slice(0, QV);
    const landline = combined.filter(l => l.phone_type === 'landline').slice(0, QL);

    finalLeads = [...wireless, ...voip, ...landline];
  } else {
    finalLeads = combined;
  }
  const wb = xlsx.utils.book_new();
  
  // Split into sheets of 400
  const CHUNK_SIZE = 400;
  for (let i = 0; i < finalLeads.length; i += CHUNK_SIZE) {
    const chunk = finalLeads.slice(i, i + CHUNK_SIZE);
    const sheetNum = Math.floor(i / CHUNK_SIZE) + 1;
    xlsx.utils.book_append_sheet(wb, toSheet(chunk), `B2B Leads ${sheetNum}`);
  }

  xlsx.utils.book_append_sheet(wb, buildStatsSheet(allLeads, hotLeads, config.INDUSTRY_NAME), 'Stats');

  try {
    xlsx.writeFile(wb, config.OUTPUT_FILE);
    console.log(`\n🏆 ELITE QUOTA OUTPUT SAVED → ${config.OUTPUT_FILE}`);
    if (config.PHONE_QUOTAS) {
      const QM = config.PHONE_QUOTAS.mobile   ?? 200;
      const QV = config.PHONE_QUOTAS.voip     ?? 100;
      const QL = config.PHONE_QUOTAS.landline  ?? 100;
      const wirelessCount = combined.filter(l => l.phone_type === 'mobile').length;
      const voipCount     = combined.filter(l => l.phone_type === 'voip').length;
      const landlineCount = combined.filter(l => l.phone_type === 'landline').length;
      console.log(`   📱 Wireless: ${wirelessCount}/${QM} | 📞 VOIP: ${voipCount}/${QV} | ☎️ Landline: ${landlineCount}/${QL}`);
      const target = QM + QV + QL;
      if (finalLeads.length < target) {
        console.log(`   💡 Keep running to fill the remaining ${target - finalLeads.length} slots.`);
      }
    } else {
      console.log(`   📝 Total Leads Saved: ${finalLeads.length}`);
    }
  } catch (e) {
    if (e.code === 'EBUSY') {
      // Excel is open — save to a timestamped backup instead of crashing
      const ts = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
      const backupPath = config.OUTPUT_FILE.replace(/\.xlsx$/, `_backup_${ts}.xlsx`);
      try {
        wb.xlsx.writeFile(backupPath);
        console.warn(`\n⚠️  Excel file was locked — saved backup to: ${backupPath}`);
      } catch (e2) {
        console.error(`\n❌ Save error (backup also failed): ${e2.message}`);
      }
    } else {
      console.error(`\n❌ Save error: ${e.message}`);
    }
  }
}

module.exports = { scoreLead, saveExcel, saveManualReview, toSheet, buildStatsSheet, initProgressFile, appendToProgress, loadProgress, HEADERS };
