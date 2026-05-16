'use strict';
/**
 * autonomous_filler.js — The "Set and Forget" Lead Engine.
 * Automatically waits for IP cooling and fills quotas to 100%.
 */
const { run } = require('./agents/agent_orchestrator');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join('D:\\LEADS GENERATION', 'leads.db');

const ROOFING_CONFIG = {
  INDUSTRY_NAME: 'Roofing',
  INDUSTRY_ID:   'RF',
  QUERIES: ['residential roofing contractor', 'roof repair company', 'roofing installation'],
  OUTPUT_FILE:   'D:\\LEADS GENERATION\\Roofing B2b.xlsx',
};

const SOLAR_CONFIG = {
  INDUSTRY_NAME: 'Solar',
  INDUSTRY_ID:   'SL',
  QUERIES: ['residential solar installer', 'solar panel installation', 'solar energy contractor'],
  OUTPUT_FILE:   'D:\\LEADS GENERATION\\Solar B2b.xlsx',
};

async function checkQuotas(industryId) {
  const db = new Database(DB_PATH);
  const rows = db.prepare('SELECT phone_type, count(*) as c FROM leads WHERE industry = ? GROUP BY phone_type').all(industryId);
  db.close();
  
  const stats = { mobile: 0, voip: 0, landline: 0 };
  rows.forEach(r => { if (stats[r.phone_type] !== undefined) stats[r.phone_type] = r.c; });
  
  return stats;
}

async function isIpBanned() {
  try {
    const res = await fetch('https://serper.dev/signup', { 
      method: 'GET', 
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' } 
    });
    const text = (await res.text()).toLowerCase();
    // Check for common ban phrases or status codes
    const isBanned = text.includes('not possible to register') || 
                     text.includes('try again later') || 
                     text.includes('too many requests') ||
                     res.status === 403 || res.status === 429;
    return isBanned;
  } catch (e) { 
    console.log(`   ⚠️ Silent check failed: ${e.message}. Assuming ban.`);
    return true; 
  }
}

async function loop() {
  console.log('\n🤖 [Auto-Pilot] Lead Generation Engine Started (Silent Mode).');
  
  while (true) {
    let allDone = true;

    // 1. SILENT IP CHECK — Don't open ANY windows if we are still banned
    if (await isIpBanned()) {
      console.log(`\n⏳ [Silent Check] IP still banned. Resting 30 mins... (No windows will open)`);
      await new Promise(r => setTimeout(r, 30 * 60 * 1000));
      continue;
    }

    for (const config of [ROOFING_CONFIG, SOLAR_CONFIG]) {
      const stats = await checkQuotas(config.INDUSTRY_ID);
      console.log(`\n📊 Status [${config.INDUSTRY_NAME}]: Mobile:${stats.mobile}/200 | VOIP:${stats.voip}/100 | Landline:${stats.landline}/100`);

      if (stats.mobile < 200 || stats.voip < 100 || stats.landline < 100) {
        allDone = false;
        console.log(`🚀 Quota incomplete. Starting aggregator for ${config.INDUSTRY_NAME}...`);
        
        try {
          await run(config);
        } catch (err) {
          if (err.message.includes('blocked') || err.message.includes('429') || err.message.includes('ban')) {
            console.log(`\n🛑 [IP Ban Detected] Serper is still cooling down. Resting for 30 minutes...`);
            await new Promise(r => setTimeout(r, 30 * 60 * 1000));
          } else {
            console.error(`\n⚠️ Unexpected Error: ${err.message}. Retrying in 5 mins...`);
            await new Promise(r => setTimeout(r, 5 * 60 * 1000));
          }
        }
      }
    }

    if (allDone) {
      console.log('\n🎉 ALL QUOTAS MET! Finalizing sheets...');
      require('child_process').execSync('node finalize_sheets.js');
      console.log('✅ System Finished. Your B2B files are ready.');
      break;
    }

    console.log('\n⏳ Waiting 5 minutes before next check...');
    await new Promise(r => setTimeout(r, 5 * 60 * 1000));
  }
}

loop().catch(console.error);
