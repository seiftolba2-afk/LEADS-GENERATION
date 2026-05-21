'use strict';
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // bypass local SSL issue

const fs   = require('fs');
const path = require('path');
const { createSharedState } = require('./agents/shared_state');
const { run, verifyPhone, findOwner } = require('./agents/agent_orchestrator');
const { enrichInstagram } = require('./agents/agent_instagram');
const { getFbFollowers } = require('./agents/agent_directory');
const { scoreLead, saveExcel, saveManualReview } = require('./agents/agent_output');
const KeyManager = require('./key_manager');

const DB_FILE = path.join(__dirname, 'leads_ID.json');

async function enrichDatabase() {
  console.log('🚀 Starting Database Enrichment & Cleansing Sweep...\n');

  if (!fs.existsSync(DB_FILE)) {
    console.error('❌ leads_ID.json not found!');
    return;
  }

  const leads = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  console.log(`📦 Loaded ${leads.length} leads from database.`);

  const { cleanOwnerName, splitSafe } = require('./agents/agent_serper');

  // Database Migration & Cleansing Sweep
  console.log('🧹 Purging invisible RTL marks, incomplete names, and landmarks...');
  let migratedCount = 0;
  for (const lead of leads) {
    if (lead.full_name) {
      const orig = lead.full_name;
      const cleaned = cleanOwnerName(lead.full_name);
      
      const parts = cleaned.split(/\s+/);
      const hasStop = parts.some(p => ['Egypt','Cairo','Giza','Hotel','Furniture','Design','Decor','Interior','Interiors','Architecture','Architects','Studio','Studios'].includes(p));
      
      if (hasStop || cleaned.length < 3 || cleaned.endsWith(' El') || cleaned.endsWith(' Al')) {
        lead.first_name = undefined;
        lead.last_name = undefined;
        lead.full_name = undefined;
        lead.name_source = undefined;
        migratedCount++;
      } else {
        const split = splitSafe(cleaned);
        if (split) {
          lead.first_name = split.firstName;
          lead.last_name = split.lastName;
          lead.full_name = split.fullName;
          if (lead.full_name !== orig) migratedCount++;
        } else {
          lead.first_name = undefined;
          lead.last_name = undefined;
          lead.full_name = undefined;
          lead.name_source = undefined;
          migratedCount++;
        }
      }
    }
    if (lead.email) {
      lead.email = lead.email.replace(/[\u200B-\u200D\uFEFF\u200E\u200F]/g, '').trim();
    }
    if (lead.phone) {
      lead.phone = lead.phone.replace(/[\u200B-\u200D\uFEFF\u200E\u200F]/g, '').trim();
    }
  }
  if (migratedCount > 0) {
    console.log(`✅ Cleansed and normalized ${migratedCount} database naming records!`);
  }

  // Initialize state
  const poolKeys = KeyManager.getAllKeys().filter(k => k.status === 'ok').map(k => k.key);
  const config = {
    INDUSTRY_NAME: 'Interior Design',
    INDUSTRY_ID:   'ID',
    SERPER_API_KEYS:     poolKeys,
    SERPER_REQUEST_CAP:  2000,
    SCRAPINGBEE_API_KEY: 'CXBUX27L6I5GVSLD0VOCI2WY1X2KMN7UWYWO5HF3LZMILEOZFWDAWBMLM2LP39C254BD0YXBL9WX0EPB',
    HOT_COUNT:           100,
    ALL_COUNT:           0,
    FIXED_COUNTS:        true,
    COUNTRY_CODE:        '+20',
    OUTPUT_FILE:         path.join(__dirname, 'out', 'Kareem Tolba.xlsx'),
  };
  const state = createSharedState(config);

  let cleanedEmails = 0;
  let preFilteredMobiles = 0;
  let instagramEnriched = 0;
  let nameEnriched = 0;

  for (let i = 0; i < leads.length; i++) {
    const lead = leads[i];
    console.log(`\n🔹 [${i + 1}/${leads.length}] Processing: "${lead.company_name}"`);

    // 1. Email Cleansing & Garbage Removal
    if (lead.email) {
      const emailLower = lead.email.toLowerCase();
      if (
        emailLower.includes('.png') ||
        emailLower.includes('.webp') ||
        emailLower.includes('.jpg') ||
        emailLower.includes('.jpeg') ||
        emailLower.includes('.gif') ||
        emailLower.includes('sentry') ||
        emailLower.includes('example') ||
        emailLower.includes('chosen-sprite') ||
        emailLower.includes('flags')
      ) {
        console.log(`   🧹 Cleansed garbage email: "${lead.email}" ➔ (Removed)`);
        lead.email = undefined;
        cleanedEmails++;
      } else {
        // Strip prefix "email" if present, e.g. emailhello@riwaq.net ➔ hello@riwaq.net
        const stripped = lead.email.replace(/^email(hello|info|contact|support|sales|marketing|admin)@/i, '$1@');
        if (stripped !== lead.email) {
          console.log(`   🧹 Cleaned email prefix: "${lead.email}" ➔ "${stripped}"`);
          lead.email = stripped;
          cleanedEmails++;
        }
      }
    }

    // 2. Local Phone Pre-Filter (Egyptian Mobile lines)
    if (lead.phone && lead.phone_type === 'unknown') {
      const digits = lead.phone.replace(/\D/g, '');
      const egMobileRegex = /^(?:20|0)?1[0125]\d{8}$/;
      if (egMobileRegex.test(digits)) {
        console.log(`   📱 Direct Mobile Pre-Filter match: "${lead.phone}" ➔ "mobile" ✓`);
        lead.phone_type = 'mobile';
        preFilteredMobiles++;
      }
    }

    // 3. Instagram Enrichment
    if (!lead.instagram_handle) {
      console.log(`   📸 Finding Instagram handle...`);
      try {
        const igProfile = await enrichInstagram(state, lead.company_name);
        if (igProfile) {
          lead.instagram_handle = igProfile.handle;
          lead.instagram_followers = igProfile.followers;
          lead.instagram_bio = igProfile.bio;
          lead.instagram_posts = igProfile.posts;
          console.log(`   ✅ Instagram Enriched: @${igProfile.handle} (${igProfile.followers} followers)`);
          instagramEnriched++;

          // If lead lacks owner name, try extracting from Instagram bio or profile name
          if (!lead.full_name) {
            let n = null;
            if (igProfile.fullName) {
              n = splitSafe(igProfile.fullName);
            }
            if (!n && igProfile.bio) {
              const { extractName } = require('./agents/agent_serper');
              n = extractName(igProfile.bio);
            }
            if (n) {
              lead.first_name = n.firstName;
              lead.last_name = n.lastName;
              lead.full_name = n.fullName;
              lead.name_source = 'L2f:InstagramBio';
              console.log(`   👤 Owner found from Instagram: "${n.fullName}"`);
              nameEnriched++;
            }
          }
        } else {
          console.log(`   ⚠️ No Instagram profile found.`);
        }
      } catch (e) {
        console.warn(`   ⚠️ Instagram enrichment error: ${e.message}`);
      }
      await new Promise(r => setTimeout(r, 500));
    }

    // 4. Missing Owner Name Serper Waterfall Enrichment
    if (!lead.full_name) {
      console.log(`   👤 Missing owner name. Re-running owner waterfall...`);
      try {
        const result = await findOwner(state, lead);
        if (result && result.name && result.name.fullName) {
          lead.first_name = result.name.firstName;
          lead.last_name = result.name.lastName;
          lead.full_name = result.name.fullName;
          lead.name_source = result.nameLayer || 'L1:Google';
          console.log(`   ✅ Owner Name Enriched: "${result.name.fullName}" (${lead.name_source})`);
          nameEnriched++;
        } else {
          console.log(`   ⚠️ Owner waterfall returned no results.`);
        }
      } catch (e) {
        console.warn(`   ⚠️ Owner enrichment error: ${e.message}`);
      }
      await new Promise(r => setTimeout(r, 500));
    }

    // 5. Missing FB Followers
    if (lead.facebook_followers == null) {
      try {
        const followers = await getFbFollowers(state, lead.company_name, lead.location_city);
        if (followers !== null) {
          lead.facebook_followers = followers;
          console.log(`   👥 Facebook followers found: ${followers}`);
        }
      } catch {}
    }

    // 6. Recalculate Completeness, Scoring & Score Reason
    const completeFields = [lead.full_name, lead.phone, lead.email, lead.company_domain, lead.location_city, lead.facebook_followers].filter(Boolean).length;
    lead.completeness_pct = Math.round((completeFields / 6) * 100);

    const { score, reason } = scoreLead(lead, lead.name_source || '');
    lead.lead_score = score;
    lead.score_reason = reason;

    if (!lead.lead_id) {
      lead.lead_id = `ID-${Date.now()}-${Math.random().toString(36).substr(2,5).toUpperCase()}`;
    }
    lead.status = 'new';
    lead.scraped_date = new Date().toLocaleDateString('en-US');
  }

  // Save the enriched leads to leads_ID.json
  fs.writeFileSync(DB_FILE, JSON.stringify(leads, null, 2));
  console.log(`\n💾 Database successfully updated and saved to ${DB_FILE}`);

  // Re-generate spreadsheets
  const hotLeads = leads.filter(l => parseInt(l.review_count) <= 100 && l.full_name).slice(0, config.HOT_COUNT);
  const hotIds   = new Set(hotLeads.map(l => l.lead_id));
  const allLeads = leads.filter(l => !hotIds.has(l.lead_id) && parseInt(l.review_count) <= 100 && l.full_name).slice(0, config.ALL_COUNT);
  
  // Leads with phone but no name go to manual review
  const noNameLeads = leads.filter(l => !l.full_name && l.phone);

  saveExcel(config, allLeads, hotLeads, `Enriched Leads ${new Date().toLocaleDateString('en-US')}`);
  if (noNameLeads.length) {
    saveManualReview(config, noNameLeads);
  }

  console.log('\n📈 --- SWEEP STATS ---');
  console.log(`✨ Garbage Emails Cleaned/Normalized: ${cleanedEmails}`);
  console.log(`⚡ Mobiles Instantly Verified: ${preFilteredMobiles}`);
  console.log(`📸 Instagram Accounts Scraped: ${instagramEnriched}`);
  console.log(`👤 Owner Names Enriched: ${nameEnriched}`);
  console.log('🏁 Enrichment sweep complete! spreadsheets generated successfully.');
}

enrichDatabase().catch(console.error);
