'use strict';
// Agent LinkedIn â€” discovers leads from LinkedIn company pages via Serper site: search

const { serperPost } = require('./agent_serper');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchCityLinkedIn(state, city, stateAbbr, stateFull, industry) {
  const queries = [
    `site:linkedin.com/company "${industry}" "${city}" "${stateAbbr}"`,
    `site:linkedin.com/company "${industry} contractor" "${city}"`,
  ];

  const leads = [];
  const seen  = new Set();

  for (const q of queries) {
    try {
      const res = await state.serperLimit(() => serperPost(state, 'search', {
        q, gl: 'eg', hl: 'en', num: 10,
      }));
      if (!res || !res.ok) { await sleep(300); continue; }
      const data = await res.json();

      for (const r of (data.organic || [])) {
        if (!r.link?.includes('linkedin.com/company')) continue;

        const url = r.link.split('?')[0].toLowerCase();
        if (seen.has(url)) continue;
        seen.add(url);

        const company_name = (r.title || '')
          .replace(/\s*[-|]\s*(LinkedIn|Company|Overview).*$/i, '')
          .trim();
        if (!company_name) continue;

        const webMatch   = (r.snippet || '').match(/(?:website|web|site):\s*([a-z0-9.-]+\.[a-z]{2,})/i);
        const domainMatch = !webMatch && (r.snippet || '').match(/\b([a-z0-9-]+\.(?:com|net|org|co|io))\b/i);

        const lead = {
          source:         'linkedin',
          company_name,
          linkedin_url:   r.link,
          location_city:  city,
          location_state: stateFull || stateAbbr,
        };
        const domain = webMatch?.[1] || domainMatch?.[1];
        if (domain) lead.company_domain = domain.toLowerCase();

        leads.push(lead);
      }
    } catch (e) {
      console.warn(`[LI] search error (${city}): ${e.message}`);
    }
    await sleep(300);
  }

  if (leads.length) console.log(`  LI ${city}, ${stateAbbr}: ${leads.length} companies`);
  return leads;
}

module.exports = { fetchCityLinkedIn };

