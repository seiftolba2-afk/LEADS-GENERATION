'use strict';
/**
 * outreach_manager.js — Personalizes and sends B2B pitches.
 * Focus: Database Reactivation for Roofing/Solar companies.
 */
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const db = new Database(path.join('D:\\LEADS GENERATION', 'leads.db'));

const PITCH_TEMPLATE = `
Subject: Question about your [City] lead list

Hi [OwnerName],

I was looking at [CompanyName] in [City] and noticed you have a strong presence there.

I'm reaching out because I specialize in "Database Reactivation" for [Industry] contractors. Basically, I take your old, 'dead' lead lists and turn them into booked appointments using an automated reactivation sequence.

The best part? It's $0 cost upfront. I only get paid if you close a deal from the list I reactivate.

Would you be open to a 2-minute chat to see if this would work for your current list?

Best,
[MyName]
`;

async function generateOutreach() {
  console.log('📧 [Outreach] Generating personalized pitches...');
  
  const leads = db.prepare(`
    SELECT * FROM leads 
    WHERE email IS NOT NULL AND email != '' 
      AND (first_name != '' OR full_name != '')
    LIMIT 20
  `).all();

  let md = '# 🚀 Database Reactivation Outreach List\n\n';
  md += '| Company | Owner | Email | Personalized Pitch |\n';
  md += '| :--- | :--- | :--- | :--- |\n';

  for (const lead of leads) {
    const owner = lead.first_name || lead.full_name.split(' ')[0] || 'Team';
    const city = lead.location_city || 'your area';
    const industry = lead.industry === 'RF' ? 'Roofing' : 'Solar';
    
    const pitch = PITCH_TEMPLATE
      .replace(/\[OwnerName\]/g, owner)
      .replace(/\[CompanyName\]/g, lead.company_name)
      .replace(/\[City\]/g, city)
      .replace(/\[Industry\]/g, industry)
      .replace(/\[MyName\]/g, 'Seif'); // Defaulting to your name

    md += `| ${lead.company_name} | ${owner} | ${lead.email} | [View Pitch](#pitch-${lead.id}) |\n`;
  }

  md += '\n---\n\n';

  for (const lead of leads) {
    const owner = lead.first_name || lead.full_name.split(' ')[0] || 'Team';
    const city = lead.location_city || 'your area';
    const industry = lead.industry === 'RF' ? 'Roofing' : 'Solar';
    
    const pitch = PITCH_TEMPLATE
      .replace(/\[OwnerName\]/g, owner)
      .replace(/\[CompanyName\]/g, lead.company_name)
      .replace(/\[City\]/g, city)
      .replace(/\[Industry\]/g, industry)
      .replace(/\[MyName\]/g, 'Seif');

    md += `<a name="pitch-${lead.id}"></a>\n`;
    md += `### Pitch for ${lead.company_name} (${lead.email})\n`;
    md += '```text\n' + pitch + '\n```\n\n';
  }

  const outPath = path.join('D:\\LEADS GENERATION', 'OUTREACH_LIST.md');
  fs.writeFileSync(outPath, md);
  console.log(`\n✅ [Outreach] Generated ${leads.length} pitches in ${outPath}`);
}

generateOutreach().catch(console.error);
