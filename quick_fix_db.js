'use strict';
const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, 'leads_ID.json');
const leads = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));

const BAD_WORDS = new Set([
  'Egypt','Cairo','Giza','Alexandria','Hotel','Hotels',
  'Furniture','Design','Decor','Interior','Interiors','Architecture','Architect',
  'Architects','Studio','Studios','Showroom','Mall','Gallery','Office','Offices',
  'Co','Corp','Ltd','Inc','LLC','Group',
]);

function cleanName(name) {
  if (!name) return '';
  // Strip invisible RTL/LTR marks and zero-width chars
  let c = name.replace(/[\u200B-\u200D\uFEFF\u200E\u200F]/g, '').trim();
  // Strip trailing business suffixes
  c = c.replace(/,?\s+(Co|Corp|Ltd|Inc|Llc|LLC|Group|Design|Designs|Studio|Studios|Architects|Architect|Egypt|Cairo|Furniture|Decor|Deco)\.?$/gi, '').trim();
  return c;
}

let fixed = 0;
for (const lead of leads) {
  // Clean RTL from all text fields
  for (const key of ['email', 'phone', 'full_name', 'first_name', 'last_name']) {
    if (lead[key] && typeof lead[key] === 'string') {
      lead[key] = lead[key].replace(/[\u200B-\u200D\uFEFF\u200E\u200F]/g, '').trim();
    }
  }

  if (lead.full_name) {
    const cleaned = cleanName(lead.full_name);
    const parts = cleaned.split(/\s+/);
    
    // Check if any part is a stop word (landmark/industry term)
    const hasStop = parts.some(p => BAD_WORDS.has(p));
    
    // Check if name is incomplete (ends with El, Al, etc.)
    const incomplete = /\s(El|Al|De|Van|Von|Di)$/i.test(cleaned);
    
    // Check if it's garbage Arabic (not a real name — too long or has non-name words)
    const isGarbageArabic = /[\u0600-\u06FF]/.test(cleaned) && cleaned.split(/\s+/).length > 4;
    
    if (hasStop || incomplete || isGarbageArabic || cleaned.length < 3) {
      console.log(`❌ REMOVED bad name: "${lead.full_name}" (${lead.company_name})`);
      lead.first_name = '';
      lead.last_name = '';
      lead.full_name = '';
      lead.name_source = '';
      fixed++;
    } else if (cleaned !== lead.full_name) {
      console.log(`🔧 FIXED name: "${lead.full_name}" ➔ "${cleaned}" (${lead.company_name})`);
      const newParts = cleaned.split(/\s+/);
      lead.first_name = newParts[0] || '';
      lead.last_name = newParts.slice(1).join(' ') || '';
      lead.full_name = cleaned;
      fixed++;
    }
  }
}

fs.writeFileSync(DB_FILE, JSON.stringify(leads, null, 2));
console.log(`\n✅ Done! Fixed ${fixed} records out of ${leads.length} total.`);

// Quick summary of what the DB looks like now
const withName = leads.filter(l => l.full_name);
const withIG = leads.filter(l => l.instagram_handle);
const withPhone = leads.filter(l => l.phone);
console.log(`\n📊 DB Summary:`);
console.log(`   Total leads: ${leads.length}`);
console.log(`   With owner name: ${withName.length}`);
console.log(`   With Instagram: ${withIG.length}`);
console.log(`   With phone: ${withPhone.length}`);
