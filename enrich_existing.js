'use strict';
/**
 * enrich_existing.js — Processes leads already in the database.
 * Bypasses Serper IP ban by using Veriphone and ScrapingBee only.
 */
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const db = new Database(path.join('D:\\LEADS GENERATION', 'leads.db'));
const { verifyPhone } = require('./agents/agent_orchestrator');
const { findOwner } = require('./agents/agent_scraper');

async function enrich() {
  console.log('📦 [Enrich] Loading leads from database...');
  
  // Get leads that haven't been verified or lack owner names
  const leads = db.prepare(`
    SELECT * FROM leads 
    WHERE (phone_type IS NULL AND phone IS NOT NULL)
       OR (first_name = '' AND company_domain IS NOT NULL AND company_domain != '')
    LIMIT 100
  `).all();

  console.log(`🚀 [Enrich] Processing batch of ${leads.length} leads...`);

  const state = {
    config: { SCRAPINGBEE_API_KEY: 'CXBUX27L6I5GVSLD0VOCI2WY1X2KMN7UWYWO5HF3LZMILEOZFWDAWBMLM2LP39C254BD0YXBL9WX0EPB' },
    serperLimit: (fn) => fn(),
  };

  for (const lead of leads) {
    console.log(`\n🔍 [Enrich] ${lead.company_name} (${lead.location_city})`);
    
    let updates = {};

    // 1. Verify Phone Type (Veriphone)
    if (!lead.phone_type && lead.phone) {
      const type = await verifyPhone(state, lead.phone);
      if (type) {
        console.log(`   📱 Phone: ${type}`);
        updates.phone_type = type;
      }
    }

    // 2. Find Owner (ScrapingBee)
    if (!lead.first_name && lead.company_domain) {
      console.log(`   👤 Searching Owner...`);
      const owner = await findOwner(state, lead.company_domain);
      if (owner) {
        console.log(`   ✅ Found: ${owner}`);
        const parts = owner.split(' ');
        updates.first_name = parts[0];
        updates.last_name = parts.slice(1).join(' ');
        updates.full_name = owner;
      }
    }

    // Save to DB
    if (Object.keys(updates).length > 0) {
      const sets = Object.keys(updates).map(k => `${k} = ?`).join(', ');
      const vals = [...Object.values(updates), lead.id];
      db.prepare(`UPDATE leads SET ${sets} WHERE id = ?`).run(...vals);
    }
  }

  console.log('\n✅ [Enrich] Batch complete.');
}

enrich().catch(console.error);
