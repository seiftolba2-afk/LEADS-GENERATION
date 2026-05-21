'use strict';
// Agent Instagram — Find and scrape Instagram profiles for Egyptian interior designers

const cheerio = require('cheerio');
const { serperPost } = require('./agent_serper');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchSafe(url, options = {}) {
  for (let attempt = 0; attempt <= 2; attempt++) {
    try {
      const res = await fetch(url, { ...options, signal: AbortSignal.timeout(20000) });
      if (res.status === 429) { await sleep(1500 * (attempt + 1)); continue; }
      if (!res.ok) return null;
      return await res.text();
    } catch {
      if (attempt === 2) return null;
      await sleep(1000);
    }
  }
  return null;
}

async function searchInstagramHandle(state, companyName) {
  const clean = companyName.replace(/,?\s*(Inc|LLC|Co|Corp|Ltd)\.?/gi, '').trim();
  const queries = [
    `"${clean}" site:instagram.com`,
    `"${clean}" interior design Egypt instagram`,
  ];
  for (const q of queries) {
    try {
      const res = await state.serperLimit(() => serperPost(state, 'search', { q, gl: 'eg', hl: 'en', num: 3 }));
      if (!res || !res.ok) continue;
      const data = await res.json();
      for (const r of (data.organic || [])) {
        const link = r.link || '';
        const m = link.match(/instagram\.com\/([a-zA-Z0-9_.]+)\b/);
        if (m) {
          const handle = m[1];
          if (!['p', 'reel', 'explore', 'stories', 'tags', 'developer'].includes(handle.toLowerCase())) {
            return handle;
          }
        }
      }
    } catch {}
  }
  return null;
}

async function scrapeInstagramProfile(state, handle) {
  const sbKey = state.config?.SCRAPINGBEE_API_KEY;
  if (!sbKey) return null;
  const url = `https://www.instagram.com/${handle}/`;
  const sbUrl = `https://app.scrapingbee.com/api/v1/?api_key=${sbKey}&url=${encodeURIComponent(url)}&render_js=false&block_ads=true`;
  try {
    const html = await state.scraperLimit(() => fetchSafe(sbUrl));
    if (!html || html.includes('Monthly API calls limit reached')) return null; // credit exhaust signature
    const $ = cheerio.load(html);
    const ogDesc = $('meta[property="og:description"]').attr('content') || '';
    const ogTitle = $('meta[property="og:title"]').attr('content') || '';
    const metaDesc = $('meta[name="description"]').attr('content') || '';

    let followers = 0;
    let posts = 0;
    let bio = '';
    let fullName = '';

    const desc = ogDesc || metaDesc;
    if (desc) {
      const followersMatch = desc.match(/([\d.,kKmM]+)\s*Followers/i);
      const postsMatch     = desc.match(/([\d.,kKmM]+)\s*Posts/i);
      if (followersMatch) {
        let val = followersMatch[1].toLowerCase().replace(/,/g, '');
        if (val.endsWith('k')) followers = parseFloat(val) * 1000;
        else if (val.endsWith('m')) followers = parseFloat(val) * 1000000;
        else followers = parseInt(val) || 0;
      }
      if (postsMatch) {
        let val = postsMatch[1].toLowerCase().replace(/,/g, '');
        if (val.endsWith('k')) posts = parseFloat(val) * 1000;
        else posts = parseInt(val) || 0;
      }
      const dashIdx = desc.indexOf(' - ');
      if (dashIdx !== -1) {
        bio = desc.slice(dashIdx + 3).trim();
      } else {
        bio = desc;
      }
    }

    if (ogTitle) {
      const nameMatch = ogTitle.match(/^([^(]+)\s*\(@/);
      if (nameMatch) {
        fullName = nameMatch[1].trim();
      }
    }

    return { handle, followers, posts, bio, fullName };
  } catch {
    return null;
  }
}

async function parseInstagramFromSerper(state, companyName) {
  const clean = companyName.replace(/,?\s*(Inc|LLC|Co|Corp|Ltd)\.?/gi, '').trim();
  const queries = [
    `"${clean}" site:instagram.com`,
    `"${clean}" interior design Egypt instagram`,
  ];
  for (const q of queries) {
    try {
      const res = await state.serperLimit(() => serperPost(state, 'search', { q, gl: 'eg', hl: 'en', num: 3 }));
      if (!res || !res.ok) continue;
      const data = await res.json();
      for (const r of (data.organic || [])) {
        const link = r.link || '';
        const m = link.match(/instagram\.com\/([a-zA-Z0-9_.]+)\b/);
        if (m) {
          const handle = m[1];
          if (!['p', 'reel', 'explore', 'stories', 'tags', 'developer'].includes(handle.toLowerCase())) {
            let followers = 0;
            let posts = 0;
            let bio = '';
            let fullName = '';

            // Title parsing for full name
            if (r.title) {
              const mTitle = r.title.match(/^([^(|·|\-|—]+)\s*(?:\(|·|-|—)/);
              if (mTitle) fullName = mTitle[1].trim();
            }

            // Snippet parsing for followers, posts, and bio
            if (r.snippet) {
              const fMatch = r.snippet.match(/([\d.,kKmM]+)\s*followers/i);
              if (fMatch) {
                let val = fMatch[1].toLowerCase().replace(/,/g, '');
                if (val.endsWith('k')) followers = parseFloat(val) * 1000;
                else if (val.endsWith('m')) followers = parseFloat(val) * 1000000;
                else followers = parseInt(val) || 0;
              }

              const pMatch = r.snippet.match(/([\d.,kKmM]+)\s*posts/i);
              if (pMatch) {
                let val = pMatch[1].toLowerCase().replace(/,/g, '');
                if (val.endsWith('k')) posts = parseFloat(val) * 1000;
                else posts = parseInt(val) || 0;
              }

              // Extract bio text
              const parts = r.snippet.split(/\s*·\s*|\s+-\s+/);
              const bioParts = parts.filter(p => !/followers|following|posts|photos and videos/i.test(p));
              if (bioParts.length > 0) {
                bio = bioParts.join(' · ').trim();
              } else {
                bio = r.snippet;
              }
            }

            return { handle, followers, posts, bio, fullName };
          }
        }
      }
    } catch {}
  }
  return null;
}

async function enrichInstagram(state, companyName) {
  const handle = await searchInstagramHandle(state, companyName);
  if (handle) {
    const profile = await scrapeInstagramProfile(state, handle);
    if (profile) return profile;
  }
  // Fallback to direct Serper snippet parsing (requires 0 ScrapingBee credits)
  return await parseInstagramFromSerper(state, companyName);
}

const IG_SKIP = /\/(p|reel|explore|stories|tags|developer|reels|channel)\//;

async function duckIGSearch(query) {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  try {
    const html = await fetchSafe(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      }
    });
    if (!html) return [];
    const results = [];
    const linkRe = /class="result__url"[^>]*>([^<]+)<\/a>/g;
    const titleRe = /class="result__a"[^>]*>([\s\S]*?)<\/a>/g;
    const snippetRe = /class="result__snippet"[^>]*>([\s\S]*?)<\/span>/g;
    const links   = [...html.matchAll(linkRe)].map(m => m[1].trim());
    const titles  = [...html.matchAll(titleRe)].map(m => m[1].replace(/<[^>]+>/g, '').trim());
    const snippets = [...html.matchAll(snippetRe)].map(m => m[1].replace(/<[^>]+>/g, '').trim());
    for (let i = 0; i < Math.min(links.length, 10); i++) {
      results.push({ link: links[i] || '', title: titles[i] || '', snippet: snippets[i] || '' });
    }
    return results;
  } catch { return []; }
}

async function fetchCityInstagram(state, city, stateAbbr, stateFull, industry) {
  const queries = [
    `site:instagram.com "${industry}" "${city}" Egypt followers`,
    `site:instagram.com "${industry}" "${city}" مصر`,
    `site:instagram.com "${industry}" Cairo Egypt interior design`,
    `site:instagram.com interior design Cairo Egypt مصمم`,
    `site:instagram.com ديكور داخلي القاهرة مصر`,
    `site:instagram.com تصميم داخلي القاهرة مصر`,
  ];

  const seen = new Set();
  const leads = [];

  const parseResult = (r) => {
    const rawLink = (r.link || '').replace(/\s/g, '');
    // Reconstruct full instagram URL if DDG strips the domain
    const link = rawLink.includes('instagram.com')
      ? rawLink
      : rawLink.startsWith('instagram.com')
        ? `https://${rawLink}`
        : null;
    if (!link || !link.includes('instagram.com')) return null;
    if (IG_SKIP.test(link)) return null;

    const url = link.split('?')[0].toLowerCase().replace(/\/$/, '');
    if (seen.has(url)) return null;
    seen.add(url);

    const m = url.match(/instagram\.com\/([a-zA-Z0-9_.]+)$/);
    if (!m) return null;
    const handle = m[1];
    if (['p', 'reel', 'explore', 'stories', 'tags', 'developer', 'accounts'].includes(handle)) return null;

    let fullName = '';
    if (r.title) {
      const mTitle = r.title.match(/^([^(|·|\-|—]+)\s*(?:\(|·|-|—)/);
      if (mTitle) fullName = mTitle[1].trim();
    }

    const company_name = fullName || handle;

    let followers = 0, posts = 0, bio = '';
    if (r.snippet) {
      const fMatch = r.snippet.match(/([\d.,kKmM]+)\s*followers/i);
      if (fMatch) {
        let val = fMatch[1].toLowerCase().replace(/,/g, '');
        if (val.endsWith('k')) followers = parseFloat(val) * 1000;
        else if (val.endsWith('m')) followers = parseFloat(val) * 1000000;
        else followers = parseInt(val) || 0;
      }
      const pMatch = r.snippet.match(/([\d.,kKmM]+)\s*posts/i);
      if (pMatch) {
        let val = pMatch[1].toLowerCase().replace(/,/g, '');
        posts = val.endsWith('k') ? parseFloat(val) * 1000 : parseInt(val) || 0;
      }
      const parts = r.snippet.split(/\s*·\s*|\s+-\s+/);
      const bioParts = parts.filter(p => !/followers|following|posts|photos and videos/i.test(p));
      bio = bioParts.length > 0 ? bioParts.join(' · ').trim() : r.snippet;
    }

    return { handle, fullName, company_name, followers, posts, bio };
  };

  for (const q of queries) {
    // Try Serper first (if keys available)
    let results = [];
    try {
      const res = await state.serperLimit(() => serperPost(state, 'search', { q, gl: 'eg', hl: 'en', num: 10 }));
      if (res && res.ok) {
        const data = await res.json();
        results = (data.organic || []).map(r => ({ link: r.link || '', title: r.title || '', snippet: r.snippet || '' }));
      }
    } catch {}

    // Fallback to DuckDuckGo (free, no key needed)
    if (results.length === 0) {
      results = await duckIGSearch(q);
      if (results.length > 0) console.log(`  [IG-DDG] Free fallback found ${results.length} results for: ${q.substring(0, 60)}`);
    }

    for (const r of results) {
      const parsed = parseResult(r);
      if (!parsed) continue;
      const lead = {
        source: 'instagram',
        company_name: parsed.company_name,
        location_city: city,
        location_state: stateFull || stateAbbr,
        instagram_handle: parsed.handle,
      };
      if (parsed.followers > 0) lead.instagram_followers = parsed.followers;
      if (parsed.posts > 0)     lead.instagram_posts = parsed.posts;
      if (parsed.bio)           lead.instagram_bio = parsed.bio;
      leads.push(lead);
    }

    await sleep(600);
  }

  if (leads.length) console.log(`  IG ${city}, ${stateAbbr}: ${leads.length} profiles`);
  return leads;
}

module.exports = { enrichInstagram, searchInstagramHandle, scrapeInstagramProfile, parseInstagramFromSerper, fetchCityInstagram };

