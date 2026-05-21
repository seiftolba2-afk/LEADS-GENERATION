'use strict';
// Agent Facebook â€” discovers leads from Facebook business pages via Serper site: search

const { serperPost, extractName } = require('./agent_serper');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const FB_SKIP = /\/(groups|events|marketplace|jobs|pages\/create|login|signup)\//;

async function fetchCityFacebook(state, city, stateAbbr, stateFull, industry) {
  const queries = [
    `site:facebook.com "${industry} contractor" "${city}, ${stateAbbr}" -groups -events -jobs`,
    `site:facebook.com "${industry}" "${city}" phone -groups -events`,
    `site:facebook.com "${industry}" "${city}" ("owner" OR "locally owned" OR "family owned") -groups -events -jobs`,
  ];

  const seen = new Set();
  const leads = [];

  for (const q of queries) {
    try {
      const res = await state.serperLimit(() => serperPost(state, 'search', {
        q, gl: 'eg', hl: 'en', num: 10,
      }));
      if (!res || !res.ok) continue;
      const data = await res.json();

      for (const r of (data.organic || [])) {
        if (!r.link?.includes('facebook.com')) continue;
        if (FB_SKIP.test(r.link)) continue;

        const url = r.link.split('?')[0].toLowerCase();
        if (seen.has(url)) continue;
        seen.add(url);

        const raw_title = r.title || '';
        const company_name = raw_title
          .replace(/\s*[-|]\s*(Home|About|Facebook|Photos|Reviews|Posts).*$/i, '')
          .trim();
        if (!company_name) continue;

        const snippet = `${r.title || ''} ${r.snippet || ''}`;

        // Phone
        const phoneMatch = snippet.match(/\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/);
        const phone = phoneMatch ? phoneMatch[0] : undefined;

        // Followers
        const fbMatch = snippet.match(/([\d,]+)\s+(?:followers?|likes?)/i);
        const facebook_followers = fbMatch ? parseInt(fbMatch[1].replace(/,/g, '')) : undefined;

        // Owner name hint from snippet
        const nameHint = extractName(snippet);

        const lead = {
          source:             'facebook',
          company_name,
          location_city:      city,
          location_state:     stateFull || stateAbbr,
          facebook_url:       r.link,
        };
        if (phone)              lead.phone              = phone;
        if (facebook_followers !== undefined) lead.facebook_followers = facebook_followers;
        if (nameHint)           lead._fb_name_hint      = nameHint;

        leads.push(lead);
      }
    } catch (e) {
      console.warn(`[FB] search error (${city}): ${e.message}`);
    }

    await sleep(400);
  }

  if (leads.length) console.log(`  FB ${city}, ${stateAbbr}: ${leads.length} pages`);
  return leads;
}

module.exports = { fetchCityFacebook };

