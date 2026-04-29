'use strict';
// best.js — curated top-N leads from all xlsx files
// Usage: node best.js --top 20   (default: 20)
//        node best.js --top 15

const xlsx  = require('xlsx');
const fs    = require('fs');
const path  = require('path');
const BASE  = 'D:\\LEADS GENERATION';

// ── Config from CLI ──────────────────────────────────────────────
const topArg = process.argv.find(a => a.startsWith('--top=') || a === '--top');
let TOP_N = 20;
if (topArg === '--top') {
  const next = process.argv[process.argv.indexOf('--top') + 1];
  if (next && /^\d+$/.test(next)) TOP_N = parseInt(next);
} else if (topArg?.startsWith('--top=')) {
  TOP_N = parseInt(topArg.split('=')[1]) || 20;
}

const MICRO_COUNT    = Math.ceil(TOP_N * 0.4);   // ~40% micro-biz (< 200 FB followers)
const OVERALL_COUNT  = TOP_N - MICRO_COUNT;        // ~60% best overall
const CANDIDATE_POOL = TOP_N * 3;                  // pre-enrichment pool size

const ABSTRACT_PHONE_KEY = '6fe0302d6fc642a8a26b8b2e4b31d416';
const SERPER_KEY         = 'ec069cd8c5fd07a1bb0dc9ab59e89d91c09a1d07';

// ── Helpers ──────────────────────────────────────────────────────
const FAKE_DOMAINS  = new Set(['domain.com','example.com','yourdomain.com','email.com','test.com',
  'sample.com','website.com','company.com','placeholder.com','none.com','dream-theme.com','nomail.com']);
const FAKE_PREFIXES = new Set(['email','user','someone','name','yourname','test','demo','sample',
  'noreply','no-reply','donotreply','placeholder','example','webmaster','postmaster']);
const TOLL_FREE     = /^(800|888|877|866|855|844|833)/;

function isFake(email) {
  if (!email) return false;
  const p = String(email).toLowerCase().split('@');
  return p.length === 2 && (FAKE_DOMAINS.has(p[1]) || FAKE_PREFIXES.has(p[0]));
}

function emailMatchesOwner(email, first, last) {
  if (!email || !first || !last) return true;
  const prefix = (email.split('@')[0] || '').toLowerCase().replace(/[^a-z]/g, '');
  if (prefix.length <= 3) return true;
  return prefix.includes(first.slice(0,3)) || prefix.includes(last.slice(0,3)) ||
         first.slice(0,3).includes(prefix.slice(0,3));
}

function extractPhoneFromText(text) {
  if (!text) return null;
  const matches = [...text.matchAll(/(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}/g)];
  for (const m of matches) {
    const digits = m[0].replace(/\D/g, '');
    const d = digits.length === 11 && digits[0] === '1' ? digits.slice(1) : digits;
    if (d.length === 10 && !TOLL_FREE.test(d)) return m[0].trim();
  }
  return null;
}

async function getPhoneType(phone) {
  if (!ABSTRACT_PHONE_KEY) return null;
  const digits = phone.replace(/\D/g, '');
  const num = digits.length === 10 ? '1' + digits : digits;
  try {
    const res = await fetch(
      `https://phoneintelligence.abstractapi.com/v1/?api_key=${ABSTRACT_PHONE_KEY}&phone=${num}`,
      { signal: AbortSignal.timeout(6000) }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data?.phone_carrier?.line_type || null; // "mobile", "landline", "voip"
  } catch { return null; }
}

async function scrapeFbPage(url) {
  try {
    const mobile = url.replace('www.facebook.com', 'm.facebook.com');
    const res = await fetch(mobile, {
      signal: AbortSignal.timeout(6000),
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1',
        'Accept': 'text/html',
      },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch { return null; }
}

async function getFbData(companyName, city) {
  const clean = companyName.replace(/,?\s*(Inc|LLC|Co|Corp|Ltd)\.?/gi, '').trim();
  try {
    const res = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'X-API-KEY': SERPER_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: `site:facebook.com "${clean}" ${city}`, gl: 'us', hl: 'en', num: 3 }),
    });
    if (!res.ok) return { followers: null, phone: null };
    const data = await res.json();
    for (const r of (data.organic || [])) {
      if (!r.link?.includes('facebook.com')) continue;
      const snippet    = `${r.title || ''} ${r.snippet || ''}`;
      const fm         = snippet.match(/([\d,]+)\s+(?:followers?|likes?)/i);
      const followers  = fm ? parseInt(fm[1].replace(/,/g, '')) : null;
      let phone        = extractPhoneFromText(snippet);
      if (!phone) {
        const html = await scrapeFbPage(r.link);
        if (html) {
          const telMatch = html.match(/tel:(\+?[\d\s\-().]+)/i);
          if (telMatch) phone = extractPhoneFromText(telMatch[1]);
          if (!phone) phone = extractPhoneFromText(html.replace(/<[^>]+>/g, ' '));
        }
      }
      if (phone || followers !== null) return { followers, phone };
    }
  } catch {}
  return { followers: null, phone: null };
}

// ── Normalize rows from any xlsx schema ──────────────────────────
function normalize(row, headers) {
  const isAggregator = headers.includes('name_source') || headers.includes('location_city');
  const maxScore     = isAggregator ? 20 : 12;
  const score        = Number(row.lead_score || 0);
  const phone        = String(row.phone || '').trim();
  const email        = String(row.email || '').trim();
  return {
    company_name:       String(row.company_name || ''),
    owner_name:         String(row.owner_name || row.full_name || ((row.first_name||'')+' '+(row.last_name||'')).trim()),
    first_name:         String(row.first_name || ''),
    last_name:          String(row.last_name  || ''),
    phone,
    phone_source:       String(row.phone_source || 'google_maps'),
    phone_type:         String(row.phone_type  || ''),
    email:              isFake(email) ? '' : email,
    linkedin_url:       String(row.linkedin_url || ''),
    website:            String(row.website || row.company_domain || ''),
    city:               String(row.city || row.location_city || ''),
    state:              String(row.state || row.location_state || ''),
    review_count:       Number(row.review_count || 0),
    rating:             String(row.rating || row.google_rating || ''),
    facebook_followers: (row.facebook_followers !== undefined && row.facebook_followers !== '') ? Number(row.facebook_followers) : null,
    confidence:         String(row.confidence || row.name_source || ''),
    lead_score:         score,
    score_reason:       String(row.score_reason || ''),
    google_maps_url:    String(row.google_maps_url || ''),
    industry:           String(row.industry || ''),
    status:             String(row.status || ''),
    lead_id:            String(row.lead_id || ''),
    _norm:              score / maxScore,
    _digits:            phone.replace(/\D/g, ''),
    _first:             String(row.first_name || '').toLowerCase().replace(/[^a-z]/g, ''),
    _last:              String(row.last_name  || '').toLowerCase().replace(/[^a-z]/g, ''),
  };
}

// ── Load all xlsx files in folder ────────────────────────────────
const OUTPUT_FILE = path.join(BASE, `Best ${TOP_N}.xlsx`);
const files = fs.readdirSync(BASE)
  .filter(f => f.endsWith('.xlsx') && !f.startsWith('~$') &&
               !/^Best\s+\d+/i.test(f) && !/^best\d+/i.test(f));

let all = [];
for (const file of files) {
  try {
    const wb   = xlsx.readFile(path.join(BASE, file));
    const ws   = wb.Sheets[wb.SheetNames[0]];
    const rows = xlsx.utils.sheet_to_json(ws, { defval: '' });
    if (!rows.length) continue;
    const headers = Object.keys(rows[0]);
    for (const row of rows) {
      const n = normalize(row, headers);
      if (n._digits.length < 10)         continue;
      if (TOLL_FREE.test(n._digits))     continue;
      if (n.review_count > 100)          continue;
      if (!n.first_name || !n.last_name) continue;
      all.push(n);
    }
  } catch (e) {
    console.warn(`  ⚠️  Skipped ${file}: ${e.message}`);
  }
}

// Dedup by phone — keep highest normalized score
const byPhone = new Map();
for (const l of all) {
  const cur = byPhone.get(l._digits);
  if (!cur || l._norm > cur._norm) byPhone.set(l._digits, l);
}
const deduped = [...byPhone.values()];
deduped.sort((a, b) => b._norm - a._norm);
const candidates = deduped.slice(0, CANDIDATE_POOL);

// ── Main ─────────────────────────────────────────────────────────
async function buildBest() {
  console.log(`\n🏆  Building Best ${TOP_N} (${MICRO_COUNT} micro + ${OVERALL_COUNT} overall)`);
  console.log(`    Pool: ${all.length} leads → ${deduped.length} deduped → ${candidates.length} candidates\n`);

  // Step 1: Enrich with Facebook data
  console.log(`🔍  Fetching Facebook data for ${candidates.length} candidates...`);
  for (let i = 0; i < candidates.length; i += 5) {
    const batch   = candidates.slice(i, i + 5);
    const results = await Promise.all(batch.map(l => getFbData(l.company_name, l.city)));
    batch.forEach((l, j) => {
      const { followers, phone: fbPhone } = results[j];
      const effectiveFollowers = followers !== null ? followers : l.facebook_followers;
      if (effectiveFollowers !== null && effectiveFollowers !== undefined) {
        l.facebook_followers = effectiveFollowers;
        if (followers !== null) {
          if (followers < 200)       { l.lead_score += 2; l.score_reason += `, ${followers} FB followers (micro)`; }
          else if (followers < 1000) { l.lead_score += 1; l.score_reason += `, ${followers} FB followers (small)`; }
          l._norm = l.lead_score / (l._norm > 0 ? l.lead_score / l._norm : 20);
        }
      }
      if (fbPhone) l._fb_phone = fbPhone;
      if (followers !== null || fbPhone)
        console.log(`  ${l.company_name.substring(0,28).padEnd(28)} → FB:${followers ?? '?'} ${fbPhone ? '| ☎ '+fbPhone : ''}`);
    });
    if (i + 5 < candidates.length) await new Promise(r => setTimeout(r, 300));
  }
  candidates.sort((a, b) => b._norm - a._norm);

  // Step 2: Phone type check (keep wireless/mobile/voip, drop landline)
  console.log('\n📱  Checking phone types...');
  const wireless = [];
  const wireTarget = Math.max(TOP_N + 5, Math.ceil(CANDIDATE_POOL * 0.5));
  for (const lead of candidates) {
    if (wireless.length >= wireTarget) break;
    const phonesToTry = [
      { phone: lead._fb_phone, source: 'facebook'    },
      { phone: lead.phone,     source: 'google_maps' },
    ].filter(p => p.phone && p.phone.replace(/\D/g,'').length >= 10);

    let chosen = null;
    for (const p of phonesToTry) {
      const type  = await getPhoneType(p.phone);
      const label = type || 'unknown';
      if (!type || type === 'mobile' || type === 'voip') {
        chosen = { phone: p.phone, source: p.source, type: label };
        break;
      }
      console.log(`  📵 ${lead.company_name.substring(0,24).padEnd(24)} ${p.source} → ${label} — trying next`);
    }
    if (!chosen) {
      // If AbstractAPI key empty, just keep the lead with unknown type
      if (!ABSTRACT_PHONE_KEY && phonesToTry.length > 0) {
        chosen = { phone: phonesToTry[0].phone, source: phonesToTry[0].source, type: 'unknown' };
      } else {
        console.log(`  ❌ ${lead.company_name.substring(0,24)} — all phones landline, skipped`);
        continue;
      }
    }
    lead.phone        = chosen.phone;
    lead.phone_source = chosen.source;
    lead.phone_type   = chosen.type;
    console.log(`  ✅ ${lead.company_name.substring(0,24).padEnd(24)} → ${chosen.type} [${chosen.source}]`);
    wireless.push(lead);
    await new Promise(r => setTimeout(r, 200));
  }

  // Step 3: Split micro-biz + overall (no overlap)
  const isMicro = l => l.facebook_followers !== null && l.facebook_followers !== undefined && l.facebook_followers < 200;
  let microGroup = wireless.filter(isMicro);
  let pickMicro  = microGroup.slice(0, MICRO_COUNT);
  if (pickMicro.length < MICRO_COUNT) {
    const extra = wireless.filter(l => !isMicro(l)).slice(0, MICRO_COUNT - pickMicro.length);
    pickMicro   = [...pickMicro, ...extra];
  }
  const pickedSet  = new Set(pickMicro);
  const pickOverall = wireless.filter(l => !pickedSet.has(l)).slice(0, OVERALL_COUNT);
  const finalLeads  = [...pickMicro, ...pickOverall];

  // Step 4: Write Excel
  const HEADERS = ['company_name','owner_name','first_name','last_name',
    'phone',
    'email','linkedin_url','website','city','state',
    'review_count','rating','facebook_followers',
    'confidence','lead_score','score_reason',
    'google_maps_url','industry','status','lead_id'];

  const sheetRows = finalLeads.map(r => {
    if (!emailMatchesOwner(r.email, r._first, r._last)) r.email = '';
    return HEADERS.reduce((o, h) => {
      o[h] = r[h] !== undefined && r[h] !== null ? String(r[h]) : '';
      return o;
    }, {});
  });

  const ws2   = xlsx.utils.json_to_sheet(sheetRows, { header: HEADERS });
  const range = xlsx.utils.decode_range(ws2['!ref']);
  // Force phone column to text
  for (let C = range.s.c; C <= range.e.c; C++) {
    const hdr = ws2[xlsx.utils.encode_cell({ r: 0, c: C })];
    if (hdr && hdr.v === 'phone') {
      for (let R = 1; R <= range.e.r; R++) {
        const a = xlsx.utils.encode_cell({ r: R, c: C });
        if (ws2[a]) { ws2[a].t = 's'; ws2[a].v = String(ws2[a].v); ws2[a].z = '@'; }
      }
    }
  }
  const wb2 = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb2, ws2, `Best ${TOP_N} Leads`);
  xlsx.writeFile(wb2, OUTPUT_FILE);

  // Step 5: Summary
  console.log(`\nPool: ${all.length} → deduped: ${deduped.length} → wireless: ${wireless.length} → final: ${finalLeads.length}`);
  console.log(`\n  — ${MICRO_COUNT} Micro-biz (< 200 FB followers) —`);
  pickMicro.forEach((r, i) => {
    const fb = r.facebook_followers !== null && r.facebook_followers !== undefined ? `FB:${r.facebook_followers}` : 'FB:?';
    console.log(`  ${String(i+1).padStart(2)}. ${r.owner_name.padEnd(22)} | ${r.company_name.substring(0,26).padEnd(26)} | ${fb} | ${r.phone_type}`);
  });
  console.log(`\n  — ${OVERALL_COUNT} Best Overall —`);
  pickOverall.forEach((r, i) => {
    const fb = r.facebook_followers !== null && r.facebook_followers !== undefined ? `FB:${r.facebook_followers}` : '';
    console.log(`  ${String(i+1).padStart(2)}. ${r.owner_name.padEnd(22)} | ${r.company_name.substring(0,26).padEnd(26)} | score:${r.lead_score} ${fb} | ${r.phone_type}`);
  });
  console.log(`\n✅  Best ${TOP_N}.xlsx saved → ${OUTPUT_FILE}`);
}

buildBest().catch(e => console.error('Error:', e.message));
