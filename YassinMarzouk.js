'use strict';
const { run } = require('./agents/agent_orchestrator');
const XLSX    = require('xlsx');
const path    = require('path');

const ROOT = 'D:\\LEADS GENERATION';

// Top US solar states by installed capacity
const SOLAR_STATES = new Set(['CA','TX','FL','AZ','NV','NC','CO','GA','VA','SC','UT','NM','TN','MD','PA']);
const CITIES = require('./cities').filter(c => SOLAR_STATES.has(c.state));

run({
  INDUSTRY_NAME: 'Solar',
  INDUSTRY_ID:   'YM',
  QUERIES: [
    'residential solar installer',
    'solar panel installation company',
    'home solar system installer',
    'solar energy contractor',
  ],
  SERPER_API_KEYS: [
    '4d927583509bb80f61a845300d6908c71912ed3b',
  ],
  OUTPUT_FILE:   path.join(ROOT, 'ym_temp.xlsx'),
  PROGRESS_FILE: path.join(ROOT, 'leads_ym_progress.csv'),
  SEEN_FILE:     path.join(ROOT, 'seen_companies_ym.json'),
  CITIES,
  PHONE_QUOTAS:  { mobile: 200, voip: 0, landline: 200 },
  SOURCE_QUOTAS: { google_maps: 100, facebook: 150, linkedin: 150 },
  HOT_COUNT:     0,
  ALL_COUNT:     400,
}).then(() => buildClientSheet()).catch(err => {
  console.error('Run failed:', err.message);
  process.exit(1);
});

async function buildClientSheet() {
  const { loadLeadsProgress } = require('./db');
  const { leads } = loadLeadsProgress('YM');

  const HEADERS = [
    'lead_id','source','first_name','last_name','full_name',
    'email','phone','phone_type','job_title','company_name','company_domain',
    'location_city','location_state','linkedin_url','facebook_followers',
    'google_rating','review_count','lead_score','score_reason',
    'name_source','status','scraped_date',
  ];

  const liLeads = leads.filter(l => l.source === 'linkedin');
  const fbLeads = leads.filter(l => l.source === 'facebook');
  const gmLeads = leads.filter(l => l.source === 'google_maps' || !l.source);

  console.log(`\nBuilding YassinMarzouk.xlsx: ${liLeads.length} LinkedIn / ${fbLeads.length} Facebook / ${gmLeads.length} Google Maps`);

  const wb = XLSX.utils.book_new();

  for (const [sheetName, rows] of [['LinkedIn Leads', liLeads], ['Facebook Leads', fbLeads], ['Google Maps Leads', gmLeads]]) {
    const ws = XLSX.utils.json_to_sheet(
      rows.map(l => {
        const row = {};
        for (const h of HEADERS) row[h] = l[h] ?? '';
        return row;
      }),
      { header: HEADERS }
    );

    // Force phone column to text format
    const phoneIdx    = HEADERS.indexOf('phone');
    const phoneColLtr = String.fromCharCode(65 + phoneIdx);
    for (let r = 2; r <= rows.length + 1; r++) {
      const cell = ws[`${phoneColLtr}${r}`];
      if (cell) { cell.t = 's'; cell.z = '@'; }
    }

    ws['!cols'] = HEADERS.map(h => ({
      wch: h === 'company_name' ? 30 : h === 'full_name' ? 22 : h === 'email' ? 28 :
           h === 'company_domain' ? 28 : h === 'score_reason' ? 40 : 14,
    }));
    ws['!autofilter'] = { ref: ws['!ref'] };

    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  }

  const out = path.join(ROOT, 'YassinMarzouk.xlsx');
  XLSX.writeFile(wb, out);
  console.log(`✅ YassinMarzouk.xlsx saved — ${liLeads.length} LinkedIn / ${fbLeads.length} Facebook / ${gmLeads.length} Google Maps`);
}
