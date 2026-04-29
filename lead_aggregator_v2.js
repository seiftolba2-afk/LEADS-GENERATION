const xlsx = require('xlsx');

// ================================================================
// LEAD AGGREGATOR v2 — Google Maps + Free Owner Name Waterfall
// Source    : Google Maps via Serper Maps API (free 2500/month)
// Waterfall : Email Prefix → Website → Blog → Reviews → Serper → State DB
// Output    : leads_v2.xlsx  (ONLY leads where owner name is confirmed)
// Cost      : $0 — uses existing free API key, no ScrapingBee
// Cities    : 40 US markets → ~800 raw leads → target 300 named / 100 hot
// ================================================================

const CONFIG = {
  SERPER_API_KEY: 'ec069cd8c5fd07a1bb0dc9ab59e89d91c09a1d07',

  // 40 high-value roofing markets across the US
  CITIES: [
    { city: 'Houston',        state: 'TX', stateFull: 'Texas'          },
    { city: 'Dallas',         state: 'TX', stateFull: 'Texas'          },
    { city: 'San Antonio',    state: 'TX', stateFull: 'Texas'          },
    { city: 'Austin',         state: 'TX', stateFull: 'Texas'          },
    { city: 'Fort Worth',     state: 'TX', stateFull: 'Texas'          },
    { city: 'Orlando',        state: 'FL', stateFull: 'Florida'        },
    { city: 'Miami',          state: 'FL', stateFull: 'Florida'        },
    { city: 'Tampa',          state: 'FL', stateFull: 'Florida'        },
    { city: 'Jacksonville',   state: 'FL', stateFull: 'Florida'        },
    { city: 'Fort Lauderdale',state: 'FL', stateFull: 'Florida'        },
    { city: 'Atlanta',        state: 'GA', stateFull: 'Georgia'        },
    { city: 'Savannah',       state: 'GA', stateFull: 'Georgia'        },
    { city: 'Charlotte',      state: 'NC', stateFull: 'North Carolina' },
    { city: 'Raleigh',        state: 'NC', stateFull: 'North Carolina' },
    { city: 'Greensboro',     state: 'NC', stateFull: 'North Carolina' },
    { city: 'Chicago',        state: 'IL', stateFull: 'Illinois'       },
    { city: 'Nashville',      state: 'TN', stateFull: 'Tennessee'      },
    { city: 'Memphis',        state: 'TN', stateFull: 'Tennessee'      },
    { city: 'Denver',         state: 'CO', stateFull: 'Colorado'       },
    { city: 'Colorado Springs',state: 'CO',stateFull: 'Colorado'       },
    { city: 'Phoenix',        state: 'AZ', stateFull: 'Arizona'        },
    { city: 'Tucson',         state: 'AZ', stateFull: 'Arizona'        },
    { city: 'Las Vegas',      state: 'NV', stateFull: 'Nevada'         },
    { city: 'Seattle',        state: 'WA', stateFull: 'Washington'     },
    { city: 'Portland',       state: 'OR', stateFull: 'Oregon'         },
    { city: 'Minneapolis',    state: 'MN', stateFull: 'Minnesota'      },
    { city: 'Detroit',        state: 'MI', stateFull: 'Michigan'       },
    { city: 'Columbus',       state: 'OH', stateFull: 'Ohio'           },
    { city: 'Cleveland',      state: 'OH', stateFull: 'Ohio'           },
    { city: 'Cincinnati',     state: 'OH', stateFull: 'Ohio'           },
    { city: 'Indianapolis',   state: 'IN', stateFull: 'Indiana'        },
    { city: 'Kansas City',    state: 'MO', stateFull: 'Missouri'       },
    { city: 'St. Louis',      state: 'MO', stateFull: 'Missouri'       },
    { city: 'Oklahoma City',  state: 'OK', stateFull: 'Oklahoma'       },
    { city: 'Tulsa',          state: 'OK', stateFull: 'Oklahoma'       },
    { city: 'Louisville',     state: 'KY', stateFull: 'Kentucky'       },
    { city: 'Birmingham',     state: 'AL', stateFull: 'Alabama'        },
    { city: 'Richmond',       state: 'VA', stateFull: 'Virginia'       },
    { city: 'Virginia Beach', state: 'VA', stateFull: 'Virginia'       },
    { city: 'Baltimore',      state: 'MD', stateFull: 'Maryland'       },
  ],

  INDUSTRY:      'roofing contractors',
  OUTPUT_FILE:   'leads_v2.xlsx',
  HOT_SCORE:     7,
  BATCH_SIZE:    5,     // leads processed in parallel
  BATCH_DELAY:   800,   // ms between batches
  REQUEST_DELAY: 1000,  // ms between Maps city requests
  FETCH_TIMEOUT: 8000,
};

const HEADERS = [
  'company_name', 'phone', 'confidence', 'owner_name',
  'first_name', 'last_name', 'email', 'website',
  'notes', 'city', 'zip', 'review_count', 'type',
  'google_maps_url', 'lead_score', 'score_reason', 'status', 'lead_id',
];

// ────────────────────────────────────────────────────────────────
// NAME VALIDATION — all returned names must pass this
// ────────────────────────────────────────────────────────────────

// Words that must NOT appear as a first OR last name
const BAD_NAME_WORDS = new Set([
  // Generic email prefixes / placeholder words
  'email','user','admin','info','help','test','demo','sample','example',
  'reception','contact','support','office','sales','team','mail','hello',
  'billing','accounts','quote','quotes','estimate','jobs','careers',
  'service','services','request','requests','booking','press','media',
  'news','feedback','webmaster','editor','author','noreply','reply',
  'postmaster','notifications','placeholder','someone','anonymous','guest',
  // Roofing / construction industry
  'roofing','roofer','roofers','solar','hvac','construction','contractor',
  'contractors','repair','restoration','management','operations','business',
  'reviews','marketing','group','company','general','residential','commercial',
  'professional','professionals','expert','experts','specialist','specialists',
  'solution','solutions','system','systems','certified','licensed',
  // Common English words that appear in HTML / website text
  'during','before','after','since','until','while','based','located',
  'serving','here','there','with','have','this','that','more','less',
  'read','learn','about','click','view','see','find','get','now','new',
  // US States (lowercase)
  'alabama','alaska','arizona','arkansas','california','colorado','connecticut',
  'delaware','florida','georgia','hawaii','idaho','illinois','indiana','iowa',
  'kansas','kentucky','louisiana','maine','maryland','massachusetts','michigan',
  'minnesota','mississippi','missouri','montana','nebraska','nevada','hampshire',
  'jersey','mexico','york','carolina','dakota','ohio','oklahoma','oregon',
  'pennsylvania','rhode','tennessee','texas','utah','vermont','virginia',
  'washington','wisconsin','wyoming',
  // Major cities (lowercase)
  'houston','dallas','austin','antonio','orlando','miami','tampa','jacksonville',
  'atlanta','charlotte','chicago','phoenix','denver','nashville','raleigh',
  'seattle','portland','minneapolis','detroit','angeles','francisco','diego',
  'vegas','boston','baltimore','columbus','indianapolis','memphis','louisville',
]);

// Broad stopwords for title/role/company words inside name captures
const STOP_WORDS = new Set([
  'The','And','Of','For','With','Inc','Llc','Company','Roofing','Construction',
  'Brothers','Sons','Contact','Us','Alert','To','Home','About','Services','Our',
  'Team','Menu','Search','Review','Rating','Quality','Best','Call','Get','Free',
  'Estimate','Group','General','Manager','President','Owner','Founder','Principal',
  'Department','Licensing','Regulation','Division','Solar','Hvac','Repair',
  'Service','Solutions','Solution','Leading','Real','Estate','Sales','Marketing',
  'Media','Business','Management','Operations','Reviews','During','Before',
  'Central','North','South','East','West','Greater','Metro','Upper','Lower',
]);

function isRealPersonName(firstName, lastName) {
  if (!firstName || firstName.length < 2 || firstName.length > 22) return false;

  const fn = firstName.toLowerCase();
  const ln = (lastName || '').toLowerCase();

  // Must start with a capital letter
  if (!/^[A-Z]/.test(firstName)) return false;
  if (lastName && !/^[A-Z]/.test(lastName)) return false;

  // No digits or unusual special chars
  if (/[\d@#$%^&*()_+=[\]{};:'",<>?/\\|`~]/.test(firstName)) return false;
  if (/[\d@#$%^&*()_+=[\]{};:'",<>?/\\|`~]/.test(lastName || '')) return false;

  // Reject if in our bad-word sets
  if (BAD_NAME_WORDS.has(fn)) return false;
  if (ln && BAD_NAME_WORDS.has(ln)) return false;
  if (STOP_WORDS.has(firstName)) return false;
  if (lastName && STOP_WORDS.has(lastName)) return false;

  // Reject if ALL CAPS and longer than 4 chars (usually an acronym, not a name)
  if (firstName === firstName.toUpperCase() && firstName.length > 4) return false;
  if (lastName && lastName === lastName.toUpperCase() && lastName.length > 4) return false;

  // Reject if last name looks like a city / state (Title-cased check against BAD_NAME_WORDS)
  if (ln && BAD_NAME_WORDS.has(ln)) return false;

  return true;
}

// ────────────────────────────────────────────────────────────────
// SAFE FETCH
// ────────────────────────────────────────────────────────────────
async function safeFetch(url, options = {}) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CONFIG.FETCH_TIMEOUT);
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
        ...(options.headers || {}),
      },
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

// ────────────────────────────────────────────────────────────────
// STEP 1 — GOOGLE MAPS VIA SERPER MAPS (free, 2500/month)
// ────────────────────────────────────────────────────────────────
async function fetchGoogleMapsLeads(city, state, stateFull) {
  try {
    const res = await fetch('https://google.serper.dev/maps', {
      method:  'POST',
      headers: { 'X-API-KEY': CONFIG.SERPER_API_KEY, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ q: CONFIG.INDUSTRY, location: `${city}, ${state}`, gl: 'us', hl: 'en', num: 20 }),
    });
    if (!res.ok) return [];
    const data = await res.json();

    return (data.places || []).map(b => {
      const zipMatch = (b.address || '').match(/\b(\d{5})\b/);
      const mapsUrl  = b.cid
        ? `https://www.google.com/maps?cid=${b.cid}`
        : `https://www.google.com/maps/search/${encodeURIComponent((b.title || '') + ' ' + city)}`;

      return {
        company_name:    (b.title       || '').trim(),
        phone:           (b.phoneNumber || '').trim(),
        email:           '',
        website:         (b.website     || '').trim(),
        city,
        stateFull,
        zip:             zipMatch ? zipMatch[1] : '',
        review_count:    b.ratingCount || 0,
        rating:          b.rating      || 0,
        type:            b.type        || 'Roofing contractor',
        google_maps_url: mapsUrl,
        company_domain:  extractDomain(b.website || ''),
        _reviews:        [],
      };
    });
  } catch {
    return [];
  }
}

// ────────────────────────────────────────────────────────────────
// STEP 2 — OWNER NAME WATERFALL (6 free layers)
// ────────────────────────────────────────────────────────────────
async function findOwnerName(lead) {
  const empty = { firstName: '', lastName: '', name: '', confidence: '', notes: '' };

  // LAYER 1 — Email prefix
  if (lead.email) {
    const r = emailPrefix(lead.email);
    if (r.firstName) return { ...r, confidence: 'email_prefix', notes: `Email prefix: ${lead.email}` };
  }

  // LAYER 2 — Website About / Team / Contact (direct fetch, free)
  if (lead.company_domain) {
    for (const path of ['/about', '/about-us', '/our-team', '/team', '/contact', '/']) {
      const html = await safeFetch(`https://${lead.company_domain}${path}`);
      if (!html) continue;

      // Opportunistically grab email from page
      if (!lead.email) {
        const em = html.match(/[\w.+\-]+@[\w\-]+\.[a-z]{2,}/i);
        if (em) {
          const found = em[0].toLowerCase();
          if (!/(gmail|yahoo|hotmail|outlook|icloud)/.test(found)) {
            lead.email = found;
            const r = emailPrefix(found);
            if (r.firstName) return { ...r, confidence: 'email_prefix', notes: `Email from website: ${found}` };
          }
        }
      }

      const r = extractNameWithRegex(stripHtml(html));
      if (r.firstName) {
        return { ...r, confidence: path === '/' ? 'website' : 'website_about', notes: `Found on ${lead.company_domain}${path}` };
      }
    }

    // LAYER 3 — Blog bylines
    for (const path of ['/blog', '/resources', '/news', '/articles']) {
      const html = await safeFetch(`https://${lead.company_domain}${path}`);
      if (!html) continue;
      const r = extractBlogByline(stripHtml(html));
      if (r.firstName) return { ...r, confidence: 'website_blog', notes: `Blog byline on ${lead.company_domain}${path}` };
    }
  }

  // LAYER 4 — Google Maps reviews (if available in API data)
  if (lead._reviews && lead._reviews.length > 0) {
    const r = extractFromReviews(lead._reviews);
    if (r.firstName) return r;
  }

  // LAYER 5 — Serper Google search (2500 free/month)
  if (lead.company_name) {
    const r = await serperSearch(lead.company_name, lead.city);
    if (r.firstName) return r;
  }

  // LAYER 6 — State contractor license DB (direct scrape, free)
  if (lead.company_name && lead.stateFull) {
    const r = await stateLicenseDB(lead.company_name, lead.stateFull);
    if (r.firstName) return r;
  }

  return empty;
}

// ────────────────────────────────────────────────────────────────
// LAYER 1 — Email prefix parser
// ────────────────────────────────────────────────────────────────
function emailPrefix(email) {
  const prefix = email.split('@')[0].toLowerCase();
  const domain = (email.split('@')[1] || '').toLowerCase();

  // Reject obvious generic/shared inboxes
  const genericPattern = /^(info|hello|contact|admin|support|sales|service|office|team|quotes?|solar|roofing?|roofer|hvac|repair|billing|accounts?|no-?reply|noreply|jobs|careers|mail|home|estimate|requests?|booking|press|media|news|feedback|webmaster|hello|website|inquiry|enquiry|general)$/;
  if (genericPattern.test(prefix)) return { firstName: '', lastName: '', name: '' };

  // Reject if prefix appears in the domain (it's the brand, not a person)
  const domainBase = domain.split('.')[0];
  if (domainBase && prefix.includes(domainBase.substring(0, 5))) return { firstName: '', lastName: '', name: '' };

  // Reject if prefix contains industry keywords
  if (/(roofer|roofing|solar|hvac|construction|contractor|repair|group|company|home|roof|builder|building)/.test(prefix)) {
    return { firstName: '', lastName: '', name: '' };
  }

  let firstName = '', lastName = '';

  if (prefix.includes('.')) {
    const parts = prefix.split('.');
    firstName = capitalize(parts[0]);
    if (parts[1] && parts[1].length >= 2) lastName = capitalize(parts[1]);
  } else if (prefix.includes('_')) {
    const parts = prefix.split('_');
    firstName = capitalize(parts[0]);
    if (parts[1] && parts[1].length >= 2) lastName = capitalize(parts[1]);
  } else if (prefix.includes('-')) {
    const parts = prefix.split('-');
    firstName = capitalize(parts[0]);
    if (parts[1] && parts[1].length >= 2) lastName = capitalize(parts[1]);
  } else {
    // Plain single word — only accept if 3-9 chars, looks like a name
    if (/^[a-z]{3,9}$/.test(prefix)) {
      firstName = capitalize(prefix);
    }
  }

  if (!isRealPersonName(firstName, lastName)) return { firstName: '', lastName: '', name: '' };
  return { firstName, lastName, name: lastName ? `${firstName} ${lastName}` : firstName };
}

// ────────────────────────────────────────────────────────────────
// LAYER 2 — Name regex extraction from website text
// ────────────────────────────────────────────────────────────────
function extractNameWithRegex(text) {
  const patterns = [
    /(?:[Oo]wner|[Ff]ounder|CEO|[Pp]resident|[Pp]rincipal|[Dd]irector)[\s\-:]+(?:Mr\.\s+|Mrs\.\s+|Ms\.\s+)?([A-Z][A-Za-z']{1,15}(?:\s+[A-Z][A-Za-z']{1,20}){1,2})/g,
    /([A-Z][A-Za-z']{1,15}(?:\s+[A-Z][A-Za-z']{1,20}){1,2})[\s,\-\|]+(?:[Oo]wner|[Ff]ounder|CEO|[Pp]resident|[Pp]rincipal)/g,
    /(?:[Ff]ounded|[Oo]wned|[Ss]tarted|[Ll]ed)\s+by\s+([A-Z][A-Za-z']{1,15}(?:\s+[A-Z][A-Za-z']{1,20}){1,2})/g,
    /(?:Hi[,!]?\s+I['']m|My name is)\s+([A-Z][A-Za-z']{1,15}(?:\s+[A-Z][A-Za-z']{1,20})?)/g,
  ];

  for (const p of patterns) {
    p.lastIndex = 0;
    let m;
    while ((m = p.exec(text)) !== null) {
      const candidate = m[1].trim();
      const parts     = candidate.split(/\s+/);
      if (parts.length < 2) continue;
      if (parts.some(w => STOP_WORDS.has(w))) continue;
      if (candidate === candidate.toUpperCase()) continue;

      const [fn, ...rest] = parts;
      const ln = rest.join(' ');
      if (isRealPersonName(fn, ln)) {
        return { firstName: fn, lastName: ln, name: candidate };
      }
    }
  }
  return { firstName: '', lastName: '', name: '' };
}

// ────────────────────────────────────────────────────────────────
// LAYER 3 — Blog byline extraction
// ────────────────────────────────────────────────────────────────
function extractBlogByline(text) {
  const p = /(?:[Bb]y|[Aa]uthor[:\s]+|[Pp]osted\s+by)\s+([A-Z][A-Za-z']{1,15}(?:\s+[A-Z][A-Za-z']{1,20})?)/g;
  p.lastIndex = 0;
  let m;
  while ((m = p.exec(text)) !== null) {
    const candidate = m[1].trim();
    const parts     = candidate.split(/\s+/);
    if (parts.length < 2) continue;
    const [fn, ...rest] = parts;
    const ln = rest.join(' ');
    if (isRealPersonName(fn, ln)) {
      return { firstName: fn, lastName: ln, name: candidate };
    }
  }
  return { firstName: '', lastName: '', name: '' };
}

// ────────────────────────────────────────────────────────────────
// LAYER 4 — Google Maps review text scan
// ────────────────────────────────────────────────────────────────
function extractFromReviews(reviews) {
  const ownerPatterns = [
    /(?:[Oo]wner|founder|president)\s+([A-Z][A-Za-z']+)/g,
    /([A-Z][A-Za-z']+)\s+(?:is\s+the\s+owner|the\s+owner)/g,
    /([A-Z][A-Za-z']+)\s+himself\s+came/g,
  ];
  const counts = {}, snippets = {};

  for (const review of reviews.slice(0, 30)) {
    const text = typeof review === 'string' ? review : (review.text || review.review_text || '');
    if (!text) continue;
    for (const p of ownerPatterns) {
      p.lastIndex = 0;
      let m;
      while ((m = p.exec(text)) !== null) {
        const nm = m[1];
        if (isRealPersonName(nm, '')) {
          counts[nm]  = (counts[nm] || 0) + 1;
          if (!snippets[nm]) snippets[nm] = text.substring(0, 150);
        }
      }
    }
  }

  if (!Object.keys(counts).length) return { firstName: '', lastName: '', name: '' };
  const [best, count] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return {
    firstName: best, lastName: '', name: best,
    confidence: count >= 3 ? 'google_review' : 'google_review_name_medium',
    notes: `Reviews mention '${best}' ${count}x: "${snippets[best]}"`,
  };
}

// ────────────────────────────────────────────────────────────────
// LAYER 5 — Serper Google search
// ────────────────────────────────────────────────────────────────
async function serperSearch(companyName, city) {
  const clean = companyName.replace(/,?\s*(Inc|LLC|Co|Corp|Ltd)\.?/gi, '').trim();
  const query = `"${clean}" ${city} (owner OR founder OR CEO OR president)`;
  const empty = { firstName: '', lastName: '', name: '' };

  try {
    const res = await fetch('https://google.serper.dev/search', {
      method:  'POST',
      headers: { 'X-API-KEY': CONFIG.SERPER_API_KEY, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ q: query, gl: 'us', hl: 'en', num: 5 }),
    });
    if (!res.ok) return empty;

    const data = await res.json();
    for (const r of (data.organic || [])) {
      // LinkedIn title: "John Smith - Owner at Big Roofing"
      if (r.link?.includes('linkedin.com/in/')) {
        const titleParts = (r.title || '').split(/[-–|]/);
        const candidate  = titleParts[0].trim();
        const parts      = candidate.split(/\s+/);
        if (parts.length >= 2) {
          const [fn, ...rest] = parts;
          const ln = rest.join(' ');
          if (isRealPersonName(fn, ln)) {
            return { firstName: fn, lastName: ln, name: candidate, confidence: 'linkedin', notes: `LinkedIn: ${(r.snippet || '').substring(0, 120)}` };
          }
        }
      }

      // General text match
      const text = `${r.title || ''} ${r.snippet || ''}`;
      const nm   = extractNameWithRegex(text);
      if (nm.firstName) {
        return { ...nm, confidence: 'google_search', notes: `Search: ${(r.snippet || '').substring(0, 120)}` };
      }
    }
  } catch { /* network error */ }
  return empty;
}

// ────────────────────────────────────────────────────────────────
// LAYER 6 — State contractor license DB (free, direct scrape)
// ────────────────────────────────────────────────────────────────
async function stateLicenseDB(companyName, state) {
  const clean = encodeURIComponent(companyName.replace(/,?\s*(Inc|LLC|Co|Corp|Ltd)\.?/gi, '').trim());
  const dbMap = {
    'Texas':          `https://www.tdlr.texas.gov/LicenseSearch/licfile.asp?searchstring=${clean}&searchtype=name&stype=all&tdsic=`,
    'Florida':        `https://www.myfloridalicense.com/wl11.asp?sid=&SID=&brd=0&typ=All&SunBiz=N&id=0&RS=1&RAD=0&nm=${clean}&ck=&bc=&SIC=`,
    'Georgia':        `https://ecorp.sos.ga.gov/BusinessSearch/BusinessInformation?businessId=&businessType=&businessStatus=Active&filingType=All&registeredAgentState=&searchName=${clean}&searchType=Contains&listType=0`,
    'North Carolina': `https://nclbgc.org/verify-a-licensee?searchBy=name&name=${clean}`,
    'Illinois':       `https://online-dfpr.micropact.com/lookup/licenselookup.aspx?SearchBy=BusinessName&SearchText=${clean}`,
    'Ohio':           `https://elicense.ohio.gov/oh_verifylicense/details.aspx?OwnerName=${clean}`,
    'Tennessee':      `https://verify.tn.gov/verifySearch?businessName=${clean}&licenseType=&city=&county=&zip=`,
    'Colorado':       `https://apps2.colorado.gov/dora/licensing/Lookup/LicenseLookup.aspx?SearchType=Name&Name=${clean}&board=CL`,
    'Arizona':        `https://roc.az.gov/contractor-search?name=${clean}&license=&city=&zip=`,
    'Missouri':       `https://pr.mo.gov/licensee-search.asp?name=${clean}&License_Number=&Status=A&submit=Search`,
    'Virginia':       `https://www.dpor.virginia.gov/LicenseLookup/license/search?Name=${clean}&Board=2400&Status=A`,
    'Maryland':       `https://www.dllr.state.md.us/cgi-bin/ElectronicLicensing/OP_Search/OP_search.cgi?calling_app=HOME_IMPROVEMENT::HI_SRCH_MAIN&action=Search&NAME=${clean}&unit=23&STATUS=A`,
  };

  const url = dbMap[state];
  if (!url) return { firstName: '', lastName: '', name: '' };

  const html = await safeFetch(url);
  if (!html) return { firstName: '', lastName: '', name: '' };
  const text = stripHtml(html);

  if (state === 'Florida') {
    const m = text.match(/[Qq]ualifier[:\s]+([A-Z][a-z]{1,15}\s+[A-Z][a-z]{1,20})/);
    if (m) return maybeReturnName(m[1], 'state_license_db');
  }
  if (['Georgia', 'North Carolina', 'Virginia', 'Maryland'].includes(state)) {
    const m = text.match(/(?:Registered Agent|Officer|Principal|License Holder|Qualifier)[:\s]+([A-Z][a-z]{1,15}\s+[A-Z][a-z]{1,20})/);
    if (m) return maybeReturnName(m[1], 'state_license_db');
  }
  if (['Ohio', 'Tennessee', 'Colorado', 'Missouri'].includes(state)) {
    const m = text.match(/(?:License(?:e|d) Name|Individual Name|Owner Name|Name)[:\s]+([A-Z][a-z]{1,15}\s+[A-Z][a-z]{1,20})/);
    if (m) return maybeReturnName(m[1], 'state_license_db');
  }

  const nm = extractNameWithRegex(text);
  if (nm.firstName) return { ...nm, confidence: 'state_license_db', notes: `${state} license DB` };
  return { firstName: '', lastName: '', name: '' };
}

function maybeReturnName(fullName, confidence) {
  const parts = fullName.trim().split(/\s+/);
  const [fn, ...rest] = parts;
  const ln = rest.join(' ');
  if (!isRealPersonName(fn, ln)) return { firstName: '', lastName: '', name: '' };
  return { firstName: fn, lastName: ln, name: fullName.trim(), confidence, notes: 'Found in state license DB' };
}

// ────────────────────────────────────────────────────────────────
// SCORING
// ────────────────────────────────────────────────────────────────
function scoreLead(lead) {
  let score = 3;
  const reasons = [];

  if (lead.confidence)                                                                                       { score += 2; reasons.push('Owner name found'); }
  // Confidence tier: reward high-trust sources, penalise low-trust
  if (['linkedin', 'state_license_db'].includes(lead.confidence))                                           { score += 2; reasons.push('High-trust name source'); }
  else if (lead.confidence === 'email_prefix')                                                               { score += 1; reasons.push('Email prefix name'); }
  else if (lead.confidence === 'website_blog')                                                               { score -= 1; reasons.push('Blog byline (lower trust)'); }
  if (lead.phone && lead.phone.replace(/\D/g, '').length >= 10)                                             { score += 2; reasons.push('Has phone'); }
  if (lead.email && lead.email.includes('@') && !/(gmail|yahoo|hotmail|outlook|icloud)/.test(lead.email))  { score += 2; reasons.push('Business email'); }
  if (lead.website)                                                                                         { score += 1; reasons.push('Has website'); }
  if (Number(lead.review_count) >= 10)                                                                      { score += 1; reasons.push(`${lead.review_count} reviews`); }
  if (['Texas','Florida','Georgia','North Carolina'].includes(lead.stateFull))                              { score += 1; reasons.push('High-demand state'); }

  return { score: Math.min(10, Math.max(1, score)), reason: reasons.join(', ') || 'Standard lead' };
}

// ────────────────────────────────────────────────────────────────
// DEDUP
// ────────────────────────────────────────────────────────────────
function dedup(leads) {
  const seen = new Set();
  return leads.filter(l => {
    const key = (l.company_domain || l.company_name || '').toLowerCase().trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ────────────────────────────────────────────────────────────────
// UTILS
// ────────────────────────────────────────────────────────────────
function stripHtml(html) {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractDomain(url) {
  if (!url) return '';
  try { return new URL(url.startsWith('http') ? url : 'https://' + url).hostname.replace(/^www\./, '').toLowerCase(); }
  catch { return ''; }
}

function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : ''; }
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// ────────────────────────────────────────────────────────────────
// EXCEL OUTPUT
// ────────────────────────────────────────────────────────────────
function forceTextColumn(ws, colName) {
  if (!ws['!ref']) return;
  const range = xlsx.utils.decode_range(ws['!ref']);
  let col = -1;
  for (let C = range.s.c; C <= range.e.c; C++) {
    const cell = ws[xlsx.utils.encode_cell({ r: 0, c: C })];
    if (cell && cell.v === colName) { col = C; break; }
  }
  if (col === -1) return;
  for (let R = 1; R <= range.e.r; R++) {
    const addr = xlsx.utils.encode_cell({ r: R, c: col });
    if (ws[addr]) { ws[addr].t = 's'; ws[addr].v = String(ws[addr].v); ws[addr].z = '@'; }
  }
}

function makeSheet(leads) {
  const rows = leads.map(l => HEADERS.map(h => l[h] !== undefined ? String(l[h]) : ''));
  const ws   = xlsx.utils.aoa_to_sheet([HEADERS, ...rows]);
  forceTextColumn(ws, 'phone');
  forceTextColumn(ws, 'zip');
  return ws;
}

function saveExcel(named) {
  const hot = named.filter(l => l.lead_score >= CONFIG.HOT_SCORE);

  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, makeSheet(named), 'All Named Leads');
  xlsx.utils.book_append_sheet(wb, makeSheet(hot),   `Hot Leads (Score >= ${CONFIG.HOT_SCORE})`);

  try {
    xlsx.writeFile(wb, CONFIG.OUTPUT_FILE);
    console.log(`\n✅  Saved: ${CONFIG.OUTPUT_FILE}`);
    console.log(`   Named leads: ${named.length} | Hot leads: ${hot.length}`);
  } catch (e) {
    if (e.code === 'EBUSY') console.error(`\n❌  Close ${CONFIG.OUTPUT_FILE} in Excel and try again.`);
    else console.error(`\n❌  Save failed: ${e.message}`);
  }
}

// ────────────────────────────────────────────────────────────────
// MAIN
// ────────────────────────────────────────────────────────────────
async function run() {
  console.log('════════════════════════════════════════════════════════════');
  console.log('  LEAD AGGREGATOR v2  |  Google Maps + Owner Name Waterfall');
  console.log('  All output leads have a confirmed real owner name.');
  console.log('════════════════════════════════════════════════════════════\n');

  // PHASE 1 — collect from Google Maps via Serper
  let rawLeads = [];
  for (const loc of CONFIG.CITIES) {
    process.stdout.write(`[Maps] ${loc.city.padEnd(14)}`);
    const leads = await fetchGoogleMapsLeads(loc.city, loc.state, loc.stateFull);
    console.log(`${leads.length} found`);
    rawLeads = rawLeads.concat(leads);
    await delay(1000);
  }

  // PHASE 2 — deduplicate
  const deduped = dedup(rawLeads);
  console.log(`\n📋  ${deduped.length} unique leads from ${rawLeads.length} raw`);

  // PHASE 2b — quality filter (established, reachable businesses only)
  const MIN_REVIEWS = 3;
  const MIN_RATING  = 3.5;
  const leads = deduped.filter(l => {
    if (!l.phone)                               return false; // no phone = uncontactable
    if (l.review_count < MIN_REVIEWS)           return false; // too new / unverified
    if (l.rating > 0 && l.rating < MIN_RATING)  return false; // poor reputation
    return true;
  });
  const dropped = deduped.length - leads.length;
  console.log(`✅  ${leads.length} pass quality filter (${dropped} dropped: no phone / <${MIN_REVIEWS} reviews / rating <${MIN_RATING})\n`);

  // PHASE 3 — owner name waterfall in parallel batches
  console.log(`🔍  Running owner name waterfall (${CONFIG.BATCH_SIZE} leads at a time)...\n`);
  const named = [];

  for (let i = 0; i < leads.length; i += CONFIG.BATCH_SIZE) {
    const batch = leads.slice(i, Math.min(i + CONFIG.BATCH_SIZE, leads.length));

    const results = await Promise.all(batch.map(async (lead, batchIdx) => {
      const r = await findOwnerName(lead);
      return { lead, r, idx: i + batchIdx };
    }));

    for (const { lead, r, idx } of results) {
      const label = lead.company_name.substring(0, 38).padEnd(38);
      if (!r.firstName) {
        console.log(`  [${String(idx + 1).padStart(3)}/${leads.length}] ${label} ⛔ removed`);
        continue;
      }
      const { score, reason } = scoreLead({ ...lead, confidence: r.confidence, email: lead.email });
      named.push({
        company_name:    lead.company_name,
        phone:           lead.phone,
        confidence:      r.confidence,
        owner_name:      r.name,
        first_name:      r.firstName,
        last_name:       r.lastName,
        email:           lead.email  || '',
        website:         lead.website || '',
        notes:           r.notes     || '',
        city:            lead.city,
        zip:             lead.zip    || '',
        review_count:    lead.review_count || 0,
        type:            lead.type   || '',
        google_maps_url: lead.google_maps_url || '',
        lead_score:      score,
        score_reason:    reason,
        status:          'new',
        lead_id:         `GM-${Date.now()}-${Math.random().toString(36).substr(2, 4).toUpperCase()}`,
        stateFull:       lead.stateFull,
      });
      const lastName = r.lastName ? ` ${r.lastName}` : '';
      console.log(`  [${String(idx + 1).padStart(3)}/${leads.length}] ${label} ✅ ${r.firstName}${lastName} [${r.confidence}] score:${score}`);
    }

    if (i + CONFIG.BATCH_SIZE < leads.length) await delay(CONFIG.BATCH_DELAY);
  }

  // PHASE 4 — save
  console.log(`\n📊  Results: ${named.length} confirmed named leads (from ${leads.length} processed)`);
  saveExcel(named);
}

run().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
