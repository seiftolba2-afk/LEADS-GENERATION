// Rebuild ALL.xlsx from the leads database (all industries combined except SL which has its own file)
const { loadLeadsProgress } = require('./db.js');
const xlsx = require('xlsx');
const fs   = require('fs');

const HEADERS = [
  'lead_id','source','first_name','last_name','full_name',
  'email','phone','phone_type','job_title','company_name','company_domain',
  'location_city','location_state','linkedin_url','facebook_followers',
  'google_rating','review_count','lead_score','score_reason','name_source','status','scraped_date',
];

function toSheet(rows) {
  const ws = xlsx.utils.json_to_sheet(rows, { header: HEADERS });
  if (!ws['!ref']) return ws;
  const range = xlsx.utils.decode_range(ws['!ref']);
  ws['!cols'] = HEADERS.map(h => {
    const w = { company_name:30, full_name:22, email:28, company_domain:28, score_reason:40, name_source:18 };
    return { wch: w[h] || 14 };
  });
  ws['!autofilter'] = { ref: ws['!ref'] };
  return ws;
}

// ALL.xlsx = Roofing only (RF)
const { leads } = loadLeadsProgress('RF');
const all = leads;
console.log(`  RF (Roofing): ${all.length} leads`);

// Deduplicate
const seen = new Set();
const unique = all.filter(l => {
  const k = (l.lead_id || l.company_name || '').toLowerCase().trim();
  if (seen.has(k)) return false;
  seen.add(k);
  return true;
});

unique.sort((a, b) => (b.lead_score || 0) - (a.lead_score || 0));

console.log(`\nTotal unique leads across all industries: ${unique.length}`);
console.log(`Saving ALL.xlsx...`);

const wb = xlsx.utils.book_new();
xlsx.utils.book_append_sheet(wb, toSheet(unique), `All Leads (${unique.length})`);
xlsx.writeFile(wb, 'ALL.xlsx');
console.log(`✅ ALL.xlsx rebuilt with ${unique.length} leads.`);
console.log(`Run "node reformat_excel.js" after ALL_SOLAR is done to apply phone type splits.`);
