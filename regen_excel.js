'use strict';
const fs = require('fs');
const path = require('path');
const { scoreLead, saveExcel, saveManualReview } = require('./agents/agent_output');

const DB_FILE = path.join(__dirname, 'leads_ID.json');
const leads = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));

// Recalculate scores for all leads
for (const lead of leads) {
  const completeFields = [lead.full_name, lead.phone, lead.email, lead.company_domain, lead.location_city, lead.facebook_followers].filter(Boolean).length;
  lead.completeness_pct = Math.round((completeFields / 6) * 100);
  const { score, reason } = scoreLead(lead, lead.name_source || '');
  lead.lead_score = score;
  lead.score_reason = reason;
}

fs.writeFileSync(DB_FILE, JSON.stringify(leads, null, 2));

const config = {
  OUTPUT_FILE: path.join(__dirname, 'out', 'Kareem Tolba.xlsx'),
  HOT_COUNT: 100,
  ALL_COUNT: 0,
};

const hotLeads = leads.filter(l => l.full_name).sort((a, b) => (b.lead_score || 0) - (a.lead_score || 0)).slice(0, config.HOT_COUNT);
const hotIds = new Set(hotLeads.map(l => l.lead_id));
const allLeads = leads.filter(l => !hotIds.has(l.lead_id) && l.full_name).slice(0, config.ALL_COUNT);
const noNameLeads = leads.filter(l => !l.full_name && l.phone);

saveExcel(config, allLeads, hotLeads, `Cleaned Leads ${new Date().toLocaleDateString('en-US')}`);
if (noNameLeads.length) {
  saveManualReview(config, noNameLeads);
}

console.log(`\n✅ Excel generated!`);
console.log(`   🏆 B2B Leads sheet: ${hotLeads.length} leads with verified owner names`);
console.log(`   📋 Manual review: ${noNameLeads.length} leads (phone only, no owner name)`);
