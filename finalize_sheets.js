const xlsx = require('xlsx');
const fs   = require('fs');
const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join('D:\\LEADS GENERATION', 'leads.db');

/**
 * finalize_sheets.js — Creates the final "Roofing B2b" and "Solar B2b" files.
 * Format: Single sheet with 200 Wireless, 100 VOIP, 100 Landline.
 */

function generateFinalSheet(industryId, filename) {
  console.log(`\n📊 Generating ${filename}...`);
  const db = new Database(DB_PATH);

  // Get Top 200 Wireless
  const wireless = db.prepare(`
    SELECT * FROM leads 
    WHERE industry = ? AND phone_type = 'mobile' 
    ORDER BY lead_score DESC LIMIT 200
  `).all(industryId);

  // Get Top 100 VOIP
  const voip = db.prepare(`
    SELECT * FROM leads 
    WHERE industry = ? AND phone_type = 'voip' 
    ORDER BY lead_score DESC LIMIT 100
  `).all(industryId);

  // Get Top 100 Landline
  const landline = db.prepare(`
    SELECT * FROM leads 
    WHERE industry = ? AND phone_type = 'landline' 
    ORDER BY lead_score DESC LIMIT 100
  `).all(industryId);

  const allLeads = [...wireless, ...voip, ...landline];

  if (allLeads.length === 0) {
    console.log(`   ⚠️ No leads found in DB for ${industryId}. Skipping file.`);
    return;
  }

  const HEADERS = [
    'lead_id','source','first_name','last_name','full_name',
    'email','phone','phone_type','job_title','company_name','company_domain',
    'location_city','location_state','linkedin_url','facebook_followers',
    'google_rating','review_count','lead_score','score_reason','name_source','status','scraped_date'
  ];

  const wb = xlsx.utils.book_new();
  const ws = xlsx.utils.json_to_sheet(allLeads, { header: HEADERS });

  // Column widths
  ws['!cols'] = HEADERS.map(h => {
    const w = { company_name:30, full_name:22, email:28, company_domain:28, score_reason:40, phone_type:15 };
    return { wch: w[h] || 14 };
  });

  xlsx.utils.book_append_sheet(wb, ws, 'B2B Leads');
  
  const fullPath = path.join('D:\\LEADS GENERATION', filename);
  xlsx.writeFile(wb, fullPath);
  
  console.log(`   ✅ Saved: ${filename}`);
  console.log(`   📈 Mix: Wireless(${wireless.length}) | VOIP(${voip.length}) | Landline(${landline.length})`);
}

async function main() {
  // 1. Generate new formatted files
  generateFinalSheet('RF', 'Roofing B2b.xlsx');
  generateFinalSheet('SL', 'Solar B2b.xlsx');

  // 2. Clean up old files to prevent confusion
  const oldFiles = ['ALL.xlsx', 'ALL_SOLAR.xlsx'];
  for (const f of oldFiles) {
    const p = path.join('D:\\LEADS GENERATION', f);
    if (fs.existsSync(p)) {
      fs.unlinkSync(p);
      console.log(`   🗑️ Deleted old file: ${f}`);
    }
  }

  console.log('\n✨ ALL FILES RENAMED AND FORMATTED CORRECTLY!\n');
}

main().catch(console.error);
