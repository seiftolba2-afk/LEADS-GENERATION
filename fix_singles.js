'use strict';
const fs = require('fs');
const f = 'leads_ID.json';
const d = JSON.parse(fs.readFileSync(f, 'utf8'));
let c = 0;
for (const l of d) {
  if (l.full_name) {
    const p = l.full_name.trim().split(/\s+/);
    if (p.length < 2) {
      console.log(`❌ Single-word name removed: "${l.full_name}" (${l.company_name})`);
      l.first_name = '';
      l.last_name = '';
      l.full_name = '';
      l.name_source = '';
      c++;
    }
  }
}
fs.writeFileSync(f, JSON.stringify(d, null, 2));
console.log(`\n✅ Removed ${c} single-word names`);
const wn = d.filter(l => l.full_name).length;
console.log(`📊 Leads with valid owner name: ${wn}/${d.length}`);
