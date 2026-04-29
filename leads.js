const xlsx = require('xlsx');
const fs   = require('fs');
const dns  = require('dns').promises;

// ================================================================
// LEADS.JS — On-demand lead generator
// Usage  : node leads.js <number> [industry]
// Example: node leads.js 300 roofing
//          node leads.js 200 solar
//          node leads.js 150 hvac
// ================================================================

const TARGET       = parseInt(process.argv[2]);
const INDUSTRY_KEY = (process.argv[3] || 'roofing').toLowerCase();

if (!TARGET || TARGET < 1) {
  console.error('\n  Usage: node leads.js <number> [industry]');
  console.error('  Industries: roofing | solar | hvac');
  console.error('  Example:    node leads.js 300 roofing\n');
  process.exit(1);
}

const INDUSTRIES = {
  roofing: {
    query:     'roofing contractors',
    label:     'Roofing',
    hotStates: ['Texas','Florida','Georgia','North Carolina','Colorado','Arizona','Oklahoma','Tennessee'],
  },
  solar: {
    query:     'solar panel installation company',
    label:     'Solar',
    hotStates: ['Texas','Florida','Arizona','Nevada','Colorado','California','New Mexico'],
  },
  hvac: {
    query:     'HVAC heating cooling company',
    label:     'HVAC',
    hotStates: ['Texas','Florida','Georgia','Arizona','Tennessee','Louisiana','Alabama'],
  },
};

const INDUSTRY = INDUSTRIES[INDUSTRY_KEY];
if (!INDUSTRY) {
  console.error(`\n  Unknown industry: "${INDUSTRY_KEY}". Use: roofing | solar | hvac\n`);
  process.exit(1);
}

const OUTPUT_DIR = 'D:\\LEADS GENERATION';

const SEEN_MAP = {
  roofing:              'seen_companies.json',
  solar:                'seen_companies_solar.json',
  hvac:                 'seen_companies_hvac.json',
  plumbing:             'seen_companies_plumbing.json',
  electrical:           'seen_companies_electrical.json',
  landscaping:          'seen_companies_landscaping.json',
  painting:             'seen_companies_painting.json',
  'general contracting':'seen_companies_general.json',
};
const SEEN_FILE = require('path').join(OUTPUT_DIR, SEEN_MAP[INDUSTRY_KEY] || 'seen_leads.json');

// Optional: add your Claude API key from console.anthropic.com for cold email drafts
// Leave blank to skip cold email generation
const CLAUDE_API_KEY = '';

const CONFIG = {
  SERPER_API_KEY:      'ec069cd8c5fd07a1bb0dc9ab59e89d91c09a1d07',
  ABSTRACT_PHONE_KEY:  '6fe0302d6fc642a8a26b8b2e4b31d416',  // abstractapi.com/phone-validation-api
  OUTPUT_FILE:    `${OUTPUT_DIR}\\leads_${TARGET}_${INDUSTRY_KEY}.xlsx`,
  HOT_SCORE:      7,
  MIN_SCORE:      7,
  BATCH_SIZE:     10,
  BATCH_DELAY:    200,
  REQUEST_DELAY:  400,
  FETCH_TIMEOUT:  4000,
  MIN_REVIEWS:    3,
  MAX_REVIEWS:    100,
  MIN_RATING:     3.5,

  CITY_POOL: [
    { city: 'Houston',          state: 'TX', stateFull: 'Texas'          },
    { city: 'Dallas',           state: 'TX', stateFull: 'Texas'          },
    { city: 'San Antonio',      state: 'TX', stateFull: 'Texas'          },
    { city: 'Austin',           state: 'TX', stateFull: 'Texas'          },
    { city: 'Fort Worth',       state: 'TX', stateFull: 'Texas'          },
    { city: 'El Paso',          state: 'TX', stateFull: 'Texas'          },
    { city: 'Arlington',        state: 'TX', stateFull: 'Texas'          },
    { city: 'Plano',            state: 'TX', stateFull: 'Texas'          },
    { city: 'Corpus Christi',   state: 'TX', stateFull: 'Texas'          },
    { city: 'Lubbock',          state: 'TX', stateFull: 'Texas'          },
    { city: 'Orlando',          state: 'FL', stateFull: 'Florida'        },
    { city: 'Miami',            state: 'FL', stateFull: 'Florida'        },
    { city: 'Tampa',            state: 'FL', stateFull: 'Florida'        },
    { city: 'Jacksonville',     state: 'FL', stateFull: 'Florida'        },
    { city: 'Fort Lauderdale',  state: 'FL', stateFull: 'Florida'        },
    { city: 'St. Petersburg',   state: 'FL', stateFull: 'Florida'        },
    { city: 'Cape Coral',       state: 'FL', stateFull: 'Florida'        },
    { city: 'Fort Myers',       state: 'FL', stateFull: 'Florida'        },
    { city: 'Tallahassee',      state: 'FL', stateFull: 'Florida'        },
    { city: 'Sarasota',         state: 'FL', stateFull: 'Florida'        },
    { city: 'Boca Raton',       state: 'FL', stateFull: 'Florida'        },
    { city: 'Gainesville',      state: 'FL', stateFull: 'Florida'        },
    { city: 'Atlanta',          state: 'GA', stateFull: 'Georgia'        },
    { city: 'Savannah',         state: 'GA', stateFull: 'Georgia'        },
    { city: 'Augusta',          state: 'GA', stateFull: 'Georgia'        },
    { city: 'Macon',            state: 'GA', stateFull: 'Georgia'        },
    { city: 'Charlotte',        state: 'NC', stateFull: 'North Carolina' },
    { city: 'Raleigh',          state: 'NC', stateFull: 'North Carolina' },
    { city: 'Greensboro',       state: 'NC', stateFull: 'North Carolina' },
    { city: 'Durham',           state: 'NC', stateFull: 'North Carolina' },
    { city: 'Winston-Salem',    state: 'NC', stateFull: 'North Carolina' },
    { city: 'Fayetteville',     state: 'NC', stateFull: 'North Carolina' },
    { city: 'Charleston',       state: 'SC', stateFull: 'South Carolina' },
    { city: 'Columbia',         state: 'SC', stateFull: 'South Carolina' },
    { city: 'Greenville',       state: 'SC', stateFull: 'South Carolina' },
    { city: 'Chicago',          state: 'IL', stateFull: 'Illinois'       },
    { city: 'Aurora',           state: 'IL', stateFull: 'Illinois'       },
    { city: 'Naperville',       state: 'IL', stateFull: 'Illinois'       },
    { city: 'Nashville',        state: 'TN', stateFull: 'Tennessee'      },
    { city: 'Memphis',          state: 'TN', stateFull: 'Tennessee'      },
    { city: 'Knoxville',        state: 'TN', stateFull: 'Tennessee'      },
    { city: 'Chattanooga',      state: 'TN', stateFull: 'Tennessee'      },
    { city: 'Clarksville',      state: 'TN', stateFull: 'Tennessee'      },
    { city: 'Denver',           state: 'CO', stateFull: 'Colorado'       },
    { city: 'Colorado Springs', state: 'CO', stateFull: 'Colorado'       },
    { city: 'Fort Collins',     state: 'CO', stateFull: 'Colorado'       },
    { city: 'Boulder',          state: 'CO', stateFull: 'Colorado'       },
    { city: 'Phoenix',          state: 'AZ', stateFull: 'Arizona'        },
    { city: 'Tucson',           state: 'AZ', stateFull: 'Arizona'        },
    { city: 'Mesa',             state: 'AZ', stateFull: 'Arizona'        },
    { city: 'Chandler',         state: 'AZ', stateFull: 'Arizona'        },
    { city: 'Scottsdale',       state: 'AZ', stateFull: 'Arizona'        },
    { city: 'Tempe',            state: 'AZ', stateFull: 'Arizona'        },
    { city: 'Gilbert',          state: 'AZ', stateFull: 'Arizona'        },
    { city: 'Las Vegas',        state: 'NV', stateFull: 'Nevada'         },
    { city: 'Henderson',        state: 'NV', stateFull: 'Nevada'         },
    { city: 'Reno',             state: 'NV', stateFull: 'Nevada'         },
    { city: 'Seattle',          state: 'WA', stateFull: 'Washington'     },
    { city: 'Spokane',          state: 'WA', stateFull: 'Washington'     },
    { city: 'Tacoma',           state: 'WA', stateFull: 'Washington'     },
    { city: 'Portland',         state: 'OR', stateFull: 'Oregon'         },
    { city: 'Eugene',           state: 'OR', stateFull: 'Oregon'         },
    { city: 'Salem',            state: 'OR', stateFull: 'Oregon'         },
    { city: 'Minneapolis',      state: 'MN', stateFull: 'Minnesota'      },
    { city: 'Saint Paul',       state: 'MN', stateFull: 'Minnesota'      },
    { city: 'Detroit',          state: 'MI', stateFull: 'Michigan'       },
    { city: 'Grand Rapids',     state: 'MI', stateFull: 'Michigan'       },
    { city: 'Lansing',          state: 'MI', stateFull: 'Michigan'       },
    { city: 'Columbus',         state: 'OH', stateFull: 'Ohio'           },
    { city: 'Cleveland',        state: 'OH', stateFull: 'Ohio'           },
    { city: 'Cincinnati',       state: 'OH', stateFull: 'Ohio'           },
    { city: 'Toledo',           state: 'OH', stateFull: 'Ohio'           },
    { city: 'Akron',            state: 'OH', stateFull: 'Ohio'           },
    { city: 'Dayton',           state: 'OH', stateFull: 'Ohio'           },
    { city: 'Indianapolis',     state: 'IN', stateFull: 'Indiana'        },
    { city: 'Fort Wayne',       state: 'IN', stateFull: 'Indiana'        },
    { city: 'Evansville',       state: 'IN', stateFull: 'Indiana'        },
    { city: 'Kansas City',      state: 'MO', stateFull: 'Missouri'       },
    { city: 'St. Louis',        state: 'MO', stateFull: 'Missouri'       },
    { city: 'Springfield',      state: 'MO', stateFull: 'Missouri'       },
    { city: 'Oklahoma City',    state: 'OK', stateFull: 'Oklahoma'       },
    { city: 'Tulsa',            state: 'OK', stateFull: 'Oklahoma'       },
    { city: 'Louisville',       state: 'KY', stateFull: 'Kentucky'       },
    { city: 'Lexington',        state: 'KY', stateFull: 'Kentucky'       },
    { city: 'Birmingham',       state: 'AL', stateFull: 'Alabama'        },
    { city: 'Montgomery',       state: 'AL', stateFull: 'Alabama'        },
    { city: 'Huntsville',       state: 'AL', stateFull: 'Alabama'        },
    { city: 'Richmond',         state: 'VA', stateFull: 'Virginia'       },
    { city: 'Virginia Beach',   state: 'VA', stateFull: 'Virginia'       },
    { city: 'Chesapeake',       state: 'VA', stateFull: 'Virginia'       },
    { city: 'Norfolk',          state: 'VA', stateFull: 'Virginia'       },
    { city: 'Baltimore',        state: 'MD', stateFull: 'Maryland'       },
    { city: 'New Orleans',      state: 'LA', stateFull: 'Louisiana'      },
    { city: 'Baton Rouge',      state: 'LA', stateFull: 'Louisiana'      },
    { city: 'Philadelphia',     state: 'PA', stateFull: 'Pennsylvania'   },
    { city: 'Pittsburgh',       state: 'PA', stateFull: 'Pennsylvania'   },
    { city: 'Milwaukee',        state: 'WI', stateFull: 'Wisconsin'      },
    { city: 'Omaha',            state: 'NE', stateFull: 'Nebraska'       },
    { city: 'Wichita',          state: 'KS', stateFull: 'Kansas'         },
    { city: 'Salt Lake City',   state: 'UT', stateFull: 'Utah'           },
    { city: 'Albuquerque',      state: 'NM', stateFull: 'New Mexico'     },
    { city: 'Las Cruces',       state: 'NM', stateFull: 'New Mexico'     },
    { city: 'Boise',            state: 'ID', stateFull: 'Idaho'          },
    { city: 'Meridian',         state: 'ID', stateFull: 'Idaho'          },
    // Texas
    { city: 'Amarillo',         state: 'TX', stateFull: 'Texas'          },
    { city: 'McKinney',         state: 'TX', stateFull: 'Texas'          },
    { city: 'Garland',          state: 'TX', stateFull: 'Texas'          },
    { city: 'Laredo',           state: 'TX', stateFull: 'Texas'          },
    // Florida
    { city: 'Clearwater',       state: 'FL', stateFull: 'Florida'        },
    { city: 'Lakeland',         state: 'FL', stateFull: 'Florida'        },
    { city: 'Palm Bay',         state: 'FL', stateFull: 'Florida'        },
    { city: 'Pompano Beach',    state: 'FL', stateFull: 'Florida'        },
    { city: 'West Palm Beach',  state: 'FL', stateFull: 'Florida'        },
    // Georgia
    { city: 'Columbus',         state: 'GA', stateFull: 'Georgia'        },
    { city: 'Athens',           state: 'GA', stateFull: 'Georgia'        },
    // North Carolina
    { city: 'Wilmington',       state: 'NC', stateFull: 'North Carolina' },
    { city: 'High Point',       state: 'NC', stateFull: 'North Carolina' },
    // Arizona
    { city: 'Peoria',           state: 'AZ', stateFull: 'Arizona'        },
    { city: 'Surprise',         state: 'AZ', stateFull: 'Arizona'        },
    // Tennessee
    { city: 'Murfreesboro',     state: 'TN', stateFull: 'Tennessee'      },
    { city: 'Johnson City',     state: 'TN', stateFull: 'Tennessee'      },
    // Virginia
    { city: 'Hampton',          state: 'VA', stateFull: 'Virginia'       },
    { city: 'Alexandria',       state: 'VA', stateFull: 'Virginia'       },
    // Ohio
    { city: 'Youngstown',       state: 'OH', stateFull: 'Ohio'           },
    { city: 'Canton',           state: 'OH', stateFull: 'Ohio'           },
    { city: 'Lorain',           state: 'OH', stateFull: 'Ohio'           },
    // Michigan
    { city: 'Ann Arbor',        state: 'MI', stateFull: 'Michigan'       },
    { city: 'Flint',            state: 'MI', stateFull: 'Michigan'       },
    // Pennsylvania
    { city: 'Allentown',        state: 'PA', stateFull: 'Pennsylvania'   },
    { city: 'Erie',             state: 'PA', stateFull: 'Pennsylvania'   },
    // Colorado
    { city: 'Aurora',           state: 'CO', stateFull: 'Colorado'       },
    { city: 'Lakewood',         state: 'CO', stateFull: 'Colorado'       },
    // Nevada
    { city: 'North Las Vegas',  state: 'NV', stateFull: 'Nevada'         },
    // Indiana
    { city: 'South Bend',       state: 'IN', stateFull: 'Indiana'        },
    { city: 'Carmel',           state: 'IN', stateFull: 'Indiana'        },
    // Missouri
    { city: 'Independence',     state: 'MO', stateFull: 'Missouri'       },
    { city: 'Columbia',         state: 'MO', stateFull: 'Missouri'       },
    // Alabama
    { city: 'Mobile',           state: 'AL', stateFull: 'Alabama'        },
    // Louisiana
    { city: 'Shreveport',       state: 'LA', stateFull: 'Louisiana'      },
    { city: 'Lafayette',        state: 'LA', stateFull: 'Louisiana'      },
    // South Carolina
    { city: 'Mount Pleasant',   state: 'SC', stateFull: 'South Carolina' },
    { city: 'Rock Hill',        state: 'SC', stateFull: 'South Carolina' },
    // Kentucky
    { city: 'Bowling Green',    state: 'KY', stateFull: 'Kentucky'       },
    { city: 'Owensboro',        state: 'KY', stateFull: 'Kentucky'       },
    // Oklahoma
    { city: 'Norman',           state: 'OK', stateFull: 'Oklahoma'       },
    { city: 'Broken Arrow',     state: 'OK', stateFull: 'Oklahoma'       },
    // Kansas
    { city: 'Overland Park',    state: 'KS', stateFull: 'Kansas'         },
    // Nebraska
    { city: 'Lincoln',          state: 'NE', stateFull: 'Nebraska'       },
    // Minnesota
    { city: 'Rochester',        state: 'MN', stateFull: 'Minnesota'      },
    // Wisconsin
    { city: 'Madison',          state: 'WI', stateFull: 'Wisconsin'      },
    { city: 'Green Bay',        state: 'WI', stateFull: 'Wisconsin'      },
    // Maryland
    { city: 'Frederick',        state: 'MD', stateFull: 'Maryland'       },
  ],
};

const HEADERS = [
  'company_name','owner_name','first_name','last_name','phone','phone_source','phone_type',
  'email','linkedin_url',
  'website','city','state','zip','review_count','rating',
  'competitor_count','storm_flag','facebook_followers',
  'confidence','lead_score','score_reason','google_maps_url',
  'industry','notes','status','lead_id',
];

// ────────────────────────────────────────────────────────────────
// CROSS-RUN DEDUPLICATION
// ────────────────────────────────────────────────────────────────
function loadSeen() {
  try { return new Set(JSON.parse(fs.readFileSync(SEEN_FILE, 'utf8'))); }
  catch { return new Set(); }
}

function appendSeen(newKeys) {
  const existing = loadSeen();
  newKeys.forEach(k => existing.add(k));
  fs.writeFileSync(SEEN_FILE, JSON.stringify([...existing]));
}

// ────────────────────────────────────────────────────────────────
// NAME VALIDATION
// ────────────────────────────────────────────────────────────────
const BAD_NAME_WORDS = new Set([
  // Generic inbox words
  'email','user','admin','info','help','test','demo','sample','example',
  'reception','contact','support','office','sales','team','mail','hello',
  'billing','accounts','quote','quotes','estimate','jobs','careers',
  'service','services','request','requests','booking','press','media',
  'news','feedback','webmaster','editor','author','noreply','reply',
  'postmaster','notifications','placeholder','someone','anonymous','guest',
  // Industry words
  'roofing','roofer','roofers','solar','hvac','construction','contractor',
  'contractors','repair','restoration','management','operations','business',
  'reviews','marketing','group','company','general','residential','commercial',
  'professional','professionals','expert','experts','specialist','specialists',
  'solution','solutions','system','systems','certified','licensed','coating',
  'coating','plumbing','electrical','painting','flooring','landscaping',
  // Website/UI words that get scraped as names
  'digital','juice','chosen','sprite','water','bear','logo','goldkey',
  'fancybox','meet','bureau','family','vice','contoso','trustindex',
  'scheduling','routine','tenant','landlord','leacon','resource','financing',
  'classic','premier','premium','elite','superior','supreme','ultimate',
  'officer','message','testimonials','appointment','named','smooth','power',
  'zoo','park','center','valley','ridge','creek','lake','hill','hills',
  'san','only','solar','energy','electric','sun','sunstra','sunrun',
  'agency','branding','brandig','tecno','spring','will','head',
  'we','do','its','our','your','their','my','his','her',
  'of','co','mr','mrs','ms','dr','jr','sr',
  // Common English words
  'during','before','after','since','until','while','based','located',
  'serving','here','there','with','have','this','that','more','less',
  'read','learn','about','click','view','see','find','get','now','new',
  // US States
  'alabama','alaska','arizona','arkansas','california','colorado','connecticut',
  'delaware','florida','georgia','hawaii','idaho','illinois','indiana','iowa',
  'kansas','kentucky','louisiana','maine','maryland','massachusetts','michigan',
  'minnesota','mississippi','missouri','montana','nebraska','nevada','hampshire',
  'jersey','mexico','york','carolina','dakota','ohio','oklahoma','oregon',
  'pennsylvania','rhode','tennessee','texas','utah','vermont','virginia',
  'washington','wisconsin','wyoming',
  // Major cities
  'houston','dallas','austin','antonio','orlando','miami','tampa','jacksonville',
  'atlanta','charlotte','chicago','phoenix','denver','nashville','raleigh',
  'seattle','portland','minneapolis','detroit','angeles','francisco','diego',
  'vegas','boston','baltimore','columbus','indianapolis','memphis','louisville',
]);

const STOP_WORDS = new Set([
  'The','And','Of','For','With','Inc','Llc','Company','Roofing','Construction',
  'Brothers','Sons','Contact','Us','Alert','To','Home','About','Services','Our',
  'Team','Menu','Search','Review','Rating','Quality','Best','Call','Get','Free',
  'Estimate','Group','General','Manager','President','Owner','Founder','Principal',
  'Department','Licensing','Regulation','Division','Solar','Hvac','Repair',
  'Service','Solutions','Solution','Leading','Real','Estate','Sales','Marketing',
  'Media','Business','Management','Operations','Reviews','During','Before',
  'Central','North','South','East','West','Greater','Metro','Upper','Lower',
  'Meet','Bureau','Digital','Sprite','Vice','Scheduling','Routine','Coating',
  'Officer','Named','Message','Testimonials','Appointment','Only','Power','Zoo',
]);

function isRealPersonName(firstName, lastName) {
  if (!firstName || firstName.length < 2 || firstName.length > 22) return false;

  const fn = firstName.toLowerCase();
  const ln = (lastName || '').toLowerCase();

  // Must start with a capital letter
  if (!/^[A-Z]/.test(firstName)) return false;
  if (lastName && !/^[A-Z]/.test(lastName)) return false;

  // No digits or special chars
  if (/[\d@#$%^&*()_+=[\]{};:'",<>?/\\|`~]/.test(firstName)) return false;
  if (/[\d@#$%^&*()_+=[\]{};:'",<>?/\\|`~]/.test(lastName || '')) return false;

  // Must contain at least one vowel (real names have vowels)
  if (!/[aeiou]/i.test(firstName)) return false;
  if (lastName && !/[aeiou]/i.test(lastName)) return false;

  // Reject ALL CAPS (3+ chars = acronym, not a name)
  if (firstName === firstName.toUpperCase() && firstName.length >= 3) return false;
  if (lastName && lastName === lastName.toUpperCase() && lastName.length >= 3) return false;

  // Reject camelCase company words (e.g. "SmoothSolar", "SunPower")
  if (/[a-z][A-Z]/.test(firstName)) return false;
  if (lastName && /[a-z][A-Z]/.test(lastName)) return false;

  // Reject duplicate first/last (e.g. "Trustindex Trustindex")
  if (lastName && fn === ln) return false;

  // Reject bad words
  if (BAD_NAME_WORDS.has(fn)) return false;
  if (ln && BAD_NAME_WORDS.has(ln)) return false;
  if (STOP_WORDS.has(firstName)) return false;
  if (lastName && STOP_WORDS.has(lastName)) return false;

  return true;
}

// ────────────────────────────────────────────────────────────────
// FAKE EMAIL DETECTION
// ────────────────────────────────────────────────────────────────
const FAKE_EMAIL_DOMAINS = new Set([
  'domain.com','example.com','yourdomain.com','yourcompany.com','yourwebsite.com',
  'email.com','test.com','sample.com','website.com','company.com','mydomain.com',
  'yourname.com','placeholder.com','mail.com','none.com','nomail.com','sitemail.com',
  'acme.com','foo.com','bar.com','baz.com','mailinator.com','yopmail.com',
]);
const FAKE_EMAIL_PREFIXES = new Set([
  'email','user','someone','name','yourname','test','demo','sample',
  'noreply','no-reply','donotreply','do-not-reply','placeholder','example',
  'webmaster','postmaster','hostmaster','abuse',
]);

function isFakeEmail(email) {
  if (!email) return true;
  const parts = email.toLowerCase().split('@');
  if (parts.length !== 2) return true;
  const [prefix, domain] = parts;
  if (FAKE_EMAIL_DOMAINS.has(domain)) return true;
  if (FAKE_EMAIL_PREFIXES.has(prefix)) return true;
  return false;
}

// ────────────────────────────────────────────────────────────────
// PHONE EXTRACTION
// ────────────────────────────────────────────────────────────────
function extractPhone(text) {
  if (!text) return null;
  const matches = [...text.matchAll(/(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}/g)];
  for (const m of matches) {
    const digits = m[0].replace(/\D/g, '');
    const d = digits.length === 11 && digits[0] === '1' ? digits.slice(1) : digits;
    if (d.length === 10 && !/^(800|888|877|866|855|844|833)/.test(d)) return m[0].trim();
  }
  return null;
}

async function getPhoneType(phone) {
  if (!CONFIG.ABSTRACT_PHONE_KEY) return null;
  const digits = phone.replace(/\D/g, '');
  const num = digits.length === 10 ? '1' + digits : digits;
  try {
    const res = await safeFetch(
      `https://phoneintelligence.abstractapi.com/v1/?api_key=${CONFIG.ABSTRACT_PHONE_KEY}&phone=${num}`
    );
    if (!res) return null;
    const data = JSON.parse(res);
    return data?.phone_carrier?.line_type || null; // "mobile", "landline", "voip"
  } catch { return null; }
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
  } catch { return null; }
}

// ────────────────────────────────────────────────────────────────
// GOOGLE MAPS VIA SERPER
// ────────────────────────────────────────────────────────────────
async function fetchGoogleMapsLeads(city, state, stateFull) {
  try {
    const res = await fetch('https://google.serper.dev/maps', {
      method:  'POST',
      headers: { 'X-API-KEY': CONFIG.SERPER_API_KEY, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ q: INDUSTRY.query, location: `${city}, ${state}`, gl: 'us', hl: 'en', num: 20 }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      if (err.message?.includes('credits')) throw new Error('OUT_OF_CREDITS');
      return [];
    }
    const data = await res.json();
    const places = data.places || [];
    const competitorCount = places.length;
    return places.map(b => {
      const zipMatch = (b.address || '').match(/\b(\d{5})\b/);
      const mapsUrl  = b.cid
        ? `https://www.google.com/maps?cid=${b.cid}`
        : `https://www.google.com/maps/search/${encodeURIComponent((b.title || '') + ' ' + city)}`;
      return {
        company_name:     (b.title       || '').trim(),
        phone:            (b.phoneNumber || '').trim(),
        email:            '',
        website:          (b.website     || '').trim(),
        city, state, stateFull,
        zip:              zipMatch ? zipMatch[1] : '',
        review_count:     b.ratingCount || 0,
        rating:           b.rating      || 0,
        type:             b.type        || INDUSTRY.label,
        google_maps_url:  mapsUrl,
        company_domain:   extractDomain(b.website || ''),
        competitor_count: competitorCount,
        _reviews:         [],
      };
    });
  } catch (e) {
    if (e.message === 'OUT_OF_CREDITS') throw e;
    return [];
  }
}

// ────────────────────────────────────────────────────────────────
// OWNER NAME WATERFALL (6 layers)
// ────────────────────────────────────────────────────────────────
async function findOwnerName(lead) {
  const empty = { firstName: '', lastName: '', name: '', confidence: '', notes: '', facebook_followers: null, facebook_phone: null };
  lead.website_phone = lead.website_phone || null;

  // Layer 1 — email prefix
  if (lead.email) {
    const r = emailPrefix(lead.email);
    if (r.firstName) return { ...r, confidence: 'email_prefix', notes: `Email: ${lead.email}` };
  }

  // Layer 2 — website pages (parallel fetch, 4 key paths)
  if (lead.company_domain) {
    const sitePaths = ['/', '/about', '/about-us', '/contact', '/our-team'];
    const htmlPages = await Promise.all(
      sitePaths.map(p => safeFetch(`https://${lead.company_domain}${p}`))
    );
    for (let i = 0; i < sitePaths.length; i++) {
      const html = htmlPages[i];
      if (!html) continue;
      if (!lead.email) {
        const mailto = html.match(/mailto:([^"'\s>?]+)/i);
        const pattern = html.match(/[\w.+\-]+@[\w\-]+\.[a-z]{2,}/i);
        const found = (mailto?.[1] || pattern?.[0] || '').replace(/[\\]/g,'').toLowerCase().trim();
        const foundDomain = (found.split('@')[1] || '');
        const domainBase  = foundDomain.split('.').slice(0,-1).join('.');
        const siteBase    = lead.company_domain.split('.').slice(0,-1).join('.');
        const domainMatch = domainBase && siteBase && (domainBase.includes(siteBase) || siteBase.includes(domainBase));
        if (found && !/(gmail|yahoo|hotmail|outlook|icloud)/.test(found) && !isFakeEmail(found) && domainMatch) {
          lead.email = found;
          const r = emailPrefix(found);
          if (r.firstName) return { ...r, confidence: 'email_prefix', notes: `Email from site: ${found}` };
        }
      }
      if (!lead.website_phone) {
        const ph = extractPhone(html);
        if (ph) lead.website_phone = ph;
      }
      const r = extractNameWithRegex(stripHtml(html));
      if (r.firstName) return { ...r, confidence: sitePaths[i] === '/' ? 'website' : 'website_about', notes: `${lead.company_domain}${sitePaths[i]}` };
    }
  }

  // Layer 4 — reviews
  if (lead._reviews?.length > 0) {
    const r = extractFromReviews(lead._reviews);
    if (r.firstName) return r;
  }

  // Layers 5 + 6 + 7 — Serper search + License DB + Facebook in parallel
  if (lead.company_name) {
    const [searchResult, licenseResult, fbResult] = await Promise.all([
      serperSearch(lead.company_name, lead.city),
      lead.stateFull ? stateLicenseDB(lead.company_name, lead.stateFull) : Promise.resolve(empty),
      facebookSearch(lead.company_name, lead.city),
    ]);
    const fb      = fbResult.followers;
    const fbPhone = fbResult.phone || null;
    if (licenseResult.firstName) return { ...licenseResult, facebook_followers: fb, facebook_phone: fbPhone };
    if (searchResult.firstName)  return { ...searchResult,  facebook_followers: fb, facebook_phone: fbPhone };
    if (fbResult.firstName)      return { ...fbResult,      facebook_followers: fb, facebook_phone: fbPhone };
    return { ...empty, facebook_followers: fb, facebook_phone: fbPhone };
  }

  return empty;
}

function emailPrefix(email) {
  const prefix    = email.split('@')[0].toLowerCase();
  const domain    = (email.split('@')[1] || '').toLowerCase();
  const domainBase = domain.split('.')[0];

  const generic = /^(info|hello|contact|admin|support|sales|service|office|team|quotes?|solar|roofing?|roofer|hvac|repair|billing|accounts?|no-?reply|noreply|jobs|careers|mail|home|estimate|requests?|booking|press|media|news|feedback|webmaster|website|inquiry|enquiry|general|help|connect)$/;
  if (generic.test(prefix)) return { firstName: '', lastName: '', name: '' };
  if (domainBase && prefix.includes(domainBase.substring(0, 5))) return { firstName: '', lastName: '', name: '' };
  if (/(roofer|roofing|solar|hvac|construction|contractor|repair|group|company|home|roof|builder|building)/.test(prefix)) return { firstName: '', lastName: '', name: '' };

  let firstName = '', lastName = '';
  const sep = prefix.includes('.') ? '.' : prefix.includes('_') ? '_' : prefix.includes('-') ? '-' : null;
  if (sep) {
    const parts = prefix.split(sep);
    firstName = capitalize(parts[0]);
    if (parts[1]?.length >= 2) lastName = capitalize(parts[1]);
  } else if (/^[a-z]{3,9}$/.test(prefix)) {
    firstName = capitalize(prefix);
  }

  if (!isRealPersonName(firstName, lastName)) return { firstName: '', lastName: '', name: '' };
  return { firstName, lastName, name: lastName ? `${firstName} ${lastName}` : firstName };
}

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
      const parts = candidate.split(/\s+/);
      if (parts.length < 2) continue;
      if (parts.some(w => STOP_WORDS.has(w))) continue;
      if (candidate === candidate.toUpperCase()) continue;
      const [fn, ...rest] = parts;
      const ln = rest.join(' ');
      if (isRealPersonName(fn, ln)) return { firstName: fn, lastName: ln, name: candidate };
    }
  }
  return { firstName: '', lastName: '', name: '' };
}

function extractBlogByline(text) {
  const p = /(?:[Bb]y|[Aa]uthor[:\s]+|[Pp]osted\s+by)\s+([A-Z][A-Za-z']{1,15}(?:\s+[A-Z][A-Za-z']{1,20})?)/g;
  p.lastIndex = 0;
  let m;
  while ((m = p.exec(text)) !== null) {
    const candidate = m[1].trim();
    const parts = candidate.split(/\s+/);
    if (parts.length < 2) continue;
    const [fn, ...rest] = parts;
    const ln = rest.join(' ');
    if (isRealPersonName(fn, ln)) return { firstName: fn, lastName: ln, name: candidate };
  }
  return { firstName: '', lastName: '', name: '' };
}

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
  return { firstName: best, lastName: '', name: best, confidence: 'google_review', notes: `Reviews: '${best}' x${count}` };
}

async function serperSearch(companyName, city) {
  const clean = companyName.replace(/,?\s*(Inc|LLC|Co|Corp|Ltd)\.?/gi, '').trim();
  const query = `"${clean}" ${city} (owner OR founder OR CEO OR president)`;
  const empty = { firstName: '', lastName: '', name: '' };
  try {
    const res = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'X-API-KEY': CONFIG.SERPER_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: query, gl: 'us', hl: 'en', num: 5 }),
    });
    if (!res.ok) return empty;
    const data = await res.json();
    for (const r of (data.organic || [])) {
      if (r.link?.includes('linkedin.com/in/')) {
        const candidate = (r.title || '').split(/[-–|]/)[0].trim();
        const parts = candidate.split(/\s+/);
        if (parts.length >= 2) {
          const [fn, ...rest] = parts;
          const ln = rest.join(' ');
          if (isRealPersonName(fn, ln)) return { firstName: fn, lastName: ln, name: candidate, confidence: 'linkedin', linkedin_url: r.link, notes: `LinkedIn: ${(r.snippet||'').substring(0,120)}` };
        }
      }
      const nm = extractNameWithRegex(`${r.title||''} ${r.snippet||''}`);
      if (nm.firstName) return { ...nm, confidence: 'google_search', notes: `Search: ${(r.snippet||'').substring(0,120)}` };
    }
  } catch { /* network */ }
  return empty;
}

async function facebookSearch(companyName, city) {
  const empty = { firstName: '', lastName: '', name: '', followers: null, phone: null };
  const clean = companyName.replace(/,?\s*(Inc|LLC|Co|Corp|Ltd)\.?/gi, '').trim();
  const query = `site:facebook.com "${clean}" ${city}`;
  try {
    const res = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'X-API-KEY': CONFIG.SERPER_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: query, gl: 'us', hl: 'en', num: 3 }),
    });
    if (!res.ok) return empty;
    const data = await res.json();
    for (const r of (data.organic || [])) {
      if (!r.link?.includes('facebook.com')) continue;
      const text = `${r.title || ''} ${r.snippet || ''}`;
      // Parse follower count from snippet e.g. "1,234 followers"
      const fm = text.match(/([\d,]+)\s+(?:followers?|likes?)/i);
      const followers = fm ? parseInt(fm[1].replace(/,/g, '')) : null;
      const phoneFb   = extractPhone(text);
      const nm = extractNameWithRegex(text);
      if (nm.firstName) return { ...nm, confidence: 'facebook', notes: `Facebook: ${(r.snippet||'').substring(0,120)}`, followers, phone: phoneFb };
      if (followers !== null || phoneFb) return { ...empty, followers, phone: phoneFb };
    }
  } catch { /* network */ }
  return empty;
}

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
  if (['Georgia','North Carolina','Virginia','Maryland'].includes(state)) {
    const m = text.match(/(?:Registered Agent|Officer|Principal|License Holder|Qualifier)[:\s]+([A-Z][a-z]{1,15}\s+[A-Z][a-z]{1,20})/);
    if (m) return maybeReturnName(m[1], 'state_license_db');
  }
  if (['Ohio','Tennessee','Colorado','Missouri'].includes(state)) {
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
  return { firstName: fn, lastName: ln, name: fullName.trim(), confidence, notes: 'State license DB' };
}

// ────────────────────────────────────────────────────────────────
// EMAIL GUESSER — pattern-based, MX-validated
// ────────────────────────────────────────────────────────────────
function guessEmails(firstName, lastName, domain) {
  if (!domain || !firstName) return '';
  const fn = firstName.toLowerCase().replace(/[^a-z]/g, '');
  const ln = (lastName || '').toLowerCase().replace(/[^a-z]/g, '');
  if (!fn) return '';
  const patterns = ln
    ? [`${fn}@${domain}`, `${fn}.${ln}@${domain}`, `${fn[0]}${ln}@${domain}`, `${fn[0]}.${ln}@${domain}`]
    : [`${fn}@${domain}`];
  return patterns.join(' | ');
}

// ────────────────────────────────────────────────────────────────
// STORM FLAG — current storm season by state
// ────────────────────────────────────────────────────────────────
function stormFlag(stateFull) {
  const month = new Date().getMonth() + 1;
  const seasons = {
    'Texas':          [3,4,5,6,7],
    'Oklahoma':       [3,4,5,6],
    'Kansas':         [4,5,6],
    'Missouri':       [4,5,6],
    'Indiana':        [4,5,6],
    'Ohio':           [4,5,6],
    'Georgia':        [3,4,5,6,7,8],
    'Alabama':        [3,4,5,6,7,8],
    'Tennessee':      [3,4,5,6],
    'North Carolina': [4,5,6,7,8],
    'South Carolina': [4,5,6,7,8],
    'Florida':        [6,7,8,9,10,11],
    'Illinois':       [4,5,6,7],
    'Minnesota':      [5,6,7,8],
    'Michigan':       [5,6,7,8],
    'Colorado':       [5,6,7,8],
    'Louisiana':      [6,7,8,9,10],
    'Virginia':       [5,6,7,8],
    'Maryland':       [5,6,7,8],
  };
  const months = seasons[stateFull];
  return (months && months.includes(month)) ? 'YES' : '';
}

// ────────────────────────────────────────────────────────────────
// COLD EMAIL DRAFT — via Claude API (optional)
// ────────────────────────────────────────────────────────────────
async function generateColdEmail(lead) {
  if (!CLAUDE_API_KEY) return '';
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key':         CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type':      'application/json',
      },
      body: JSON.stringify({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 120,
        messages: [{
          role:    'user',
          content: `Write a 2-sentence cold email to ${lead.first_name}, owner of ${lead.company_name} in ${lead.city}. They are a ${lead.industry} contractor with ${lead.review_count} Google reviews and ${lead.competitor_count} competitors in their market. Offer lead generation services. Be casual, direct, mention one specific detail, end with a yes/no question. No subject line, just the body.`,
        }],
      }),
    });
    const data = await res.json();
    return (data.content?.[0]?.text || '').trim();
  } catch { return ''; }
}

// ────────────────────────────────────────────────────────────────
// SCORING — recalibrated for real spread (0–10)
// ────────────────────────────────────────────────────────────────
function scoreLead(lead) {
  let score = 0;
  const reasons = [];

  // Name confidence (biggest differentiator)
  const conf = lead.confidence;
  if (conf === 'linkedin')                                                    { score += 4; reasons.push('LinkedIn'); }
  else if (conf === 'state_license_db')                                       { score += 3; reasons.push('License DB'); }
  else if (['website_about','email_prefix','website'].includes(conf))         { score += 2; reasons.push('Website/email'); }
  else if (['google_search','google_review'].includes(conf))                  { score += 2; reasons.push('Google search'); }
  else if (conf === 'website_blog')                                           { score += 1; reasons.push('Blog byline'); }

  // Contact quality
  if (lead.phone && lead.phone.replace(/\D/g,'').length >= 10)               { score += 2; reasons.push('Phone'); }
  if (lead.email && !/(gmail|yahoo|hotmail|outlook|icloud)/.test(lead.email)){ score += 2; reasons.push('Business email'); }

  // Business quality
  const rc = Number(lead.review_count) || 0;
  if (rc >= 50)       { score += 2; reasons.push(`${rc} reviews`); }
  else if (rc >= 25)  { score += 1; reasons.push(`${rc} reviews`); }

  if (Number(lead.rating) >= 4.5) { score += 1; reasons.push(`${lead.rating}★`); }

  // Facebook followers — fewer = owner more likely answers directly
  const fb = Number(lead.facebook_followers);
  if (lead.facebook_followers !== null && lead.facebook_followers !== undefined && lead.facebook_followers !== '') {
    if (fb < 200)        { score += 2; reasons.push(`${fb} FB followers (micro)`); }
    else if (fb < 1000)  { score += 1; reasons.push(`${fb} FB followers (small)`); }
  }

  // Hot market
  if (INDUSTRY.hotStates.includes(lead.stateFull)) { score += 1; reasons.push('Hot market'); }

  return { score: Math.min(12, score), reason: reasons.join(', ') || 'Basic lead' };
}

// ────────────────────────────────────────────────────────────────
// UTILS
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

function saveExcel(leads) {
  const sorted = [...leads].sort((a, b) => b.lead_score - a.lead_score);
  const rows   = sorted.map(l => HEADERS.map(h => l[h] !== undefined ? String(l[h]) : ''));
  const ws     = xlsx.utils.aoa_to_sheet([HEADERS, ...rows]);
  forceTextColumn(ws, 'phone');
  forceTextColumn(ws, 'zip');
  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, ws, 'Leads');
  try {
    xlsx.writeFile(wb, CONFIG.OUTPUT_FILE);
    console.log(`  💾 Checkpoint: ${sorted.length} leads saved → ${CONFIG.OUTPUT_FILE}`);
  } catch (e) {
    if (e.code === 'EBUSY') console.error(`  ❌  Close the Excel file and try again.`);
    else console.error(`  ❌  Save failed: ${e.message}`);
  }
}

// ────────────────────────────────────────────────────────────────
// MAIN
// ────────────────────────────────────────────────────────────────
async function run() {
  console.log('════════════════════════════════════════════════════════════');
  console.log(`  LEAD GENERATOR  |  ${TARGET} ${INDUSTRY.label} leads`);
  console.log('════════════════════════════════════════════════════════════\n');

  // Load previously seen companies (cross-run dedup)
  const seenCompanies = loadSeen();
  console.log(`📂  Skipping ${seenCompanies.size} companies from previous runs\n`);

  // How many cities needed
  const citiesToUse = CONFIG.CITY_POOL;
  console.log(`📍  Using all ${citiesToUse.length} cities\n`);

  // PHASE 1 — Maps (4 cities at a time)
  let rawLeads = [];
  const CITY_CHUNK = 4;
  for (let ci = 0; ci < citiesToUse.length; ci += CITY_CHUNK) {
    const chunk = citiesToUse.slice(ci, ci + CITY_CHUNK);
    let outOfCredits = false;
    const results = await Promise.all(chunk.map(async loc => {
      try {
        const leads = await fetchGoogleMapsLeads(loc.city, loc.state, loc.stateFull);
        console.log(`[Maps] ${loc.city.padEnd(16)} ${leads.length} found`);
        return leads;
      } catch (e) {
        if (e.message === 'OUT_OF_CREDITS') { outOfCredits = true; return []; }
        console.log(`[Maps] ${loc.city.padEnd(16)} 0 (error)`);
        return [];
      }
    }));
    if (outOfCredits) {
      console.error('\n❌  Serper API out of credits. Get a new key at serper.dev and update leads.js.');
      process.exit(1);
    }
    rawLeads = rawLeads.concat(results.flat());
    if (ci + CITY_CHUNK < citiesToUse.length) await delay(CONFIG.REQUEST_DELAY);
  }

  // PHASE 2 — dedup + cross-run dedup + quality filter
  const deduped = dedup(rawLeads);
  const leads = deduped.filter(l => {
    const ph = (l.phone || '').replace(/\D/g,'');
    if (ph.length < 10) return false;
    if (/^(800|888|877|866|855|844|833)/.test(ph)) return false;
    if (l.review_count < CONFIG.MIN_REVIEWS)              return false;
    if (l.review_count > CONFIG.MAX_REVIEWS)              return false;
    if (l.rating > 0 && l.rating < CONFIG.MIN_RATING)    return false;
    const key = (l.company_domain || l.company_name || '').toLowerCase().trim();
    if (seenCompanies.has(key))                          return false;
    return true;
  });
  console.log(`\n📋  ${leads.length} fresh qualified leads (${deduped.length - leads.length} already seen)\n`);

  // PHASE 3 — parallel waterfall
  console.log(`🔍  Finding owner names (10 at a time) — target: ${TARGET}...\n`);
  const named = [];

  for (let i = 0; i < leads.length; i += CONFIG.BATCH_SIZE) {
    const batch = leads.slice(i, Math.min(i + CONFIG.BATCH_SIZE, leads.length));
    const results = await Promise.all(batch.map(async (lead, batchIdx) => {
      const r = await findOwnerName(lead);
      return { lead, r, idx: i + batchIdx };
    }));

    for (const { lead, r, idx } of results) {
      const label = lead.company_name.substring(0, 34).padEnd(34);
      if (!r.firstName || !r.lastName) {
        console.log(`  [${String(idx+1).padStart(3)}/${leads.length}] ${label} ⛔`);
        continue;
      }
      // Clear email if prefix suggests a different person than the owner
      const emailPrefix0 = (lead.email || '').split('@')[0].toLowerCase().replace(/[^a-z]/g, '');
      const fn0 = r.firstName.toLowerCase().replace(/[^a-z]/g, '');
      const ln0 = r.lastName.toLowerCase().replace(/[^a-z]/g, '');
      if (emailPrefix0.length > 3 && fn0 && ln0) {
        const emailMatchesOwner = emailPrefix0.includes(fn0.slice(0,3)) ||
                                  emailPrefix0.includes(ln0.slice(0,3)) ||
                                  fn0.slice(0,3).includes(emailPrefix0.slice(0,3));
        if (!emailMatchesOwner) lead.email = '';
      }
      const phoneCandidates = [
        { phone: r.facebook_phone,  source: 'facebook'    },
        { phone: lead.website_phone, source: 'website'    },
        { phone: lead.phone,         source: 'google_maps' },
      ].filter(p => p.phone && p.phone.replace(/\D/g,'').length >= 10);

      let bestPhone = '', phoneSource = '', phoneType = 'unknown';
      for (const candidate of phoneCandidates) {
        const type = await getPhoneType(candidate.phone);
        if (!type || type === 'mobile' || type === 'voip') {
          bestPhone   = candidate.phone;
          phoneSource = candidate.source;
          phoneType   = type || 'unknown';
          break;
        }
        console.log(`    📵 ${candidate.source} phone is landline — trying next`);
      }
      if (!bestPhone && CONFIG.ABSTRACT_PHONE_KEY) {
        process.stdout.write('📵 all phones landline — skipped\n');
        dropped++;
        return;
      }
      if (!bestPhone) {
        bestPhone   = phoneCandidates[0]?.phone   || '';
        phoneSource = phoneCandidates[0]?.source  || 'none';
      }
      const { score, reason } = scoreLead({ ...lead, confidence: r.confidence, email: lead.email, facebook_followers: r.facebook_followers ?? null });
      named.push({
        company_name:     lead.company_name,
        owner_name:       r.name,
        first_name:       r.firstName,
        last_name:        r.lastName,
        phone:            bestPhone,
        phone_source:     phoneSource,
        phone_type:       phoneType,
        email:            lead.email       || '',
        linkedin_url:     r.linkedin_url   || '',
        website:          lead.website     || '',
        city:             lead.city,
        state:            lead.state       || '',
        zip:              lead.zip         || '',
        review_count:     lead.review_count || 0,
        rating:           lead.rating      || '',
        competitor_count: lead.competitor_count || 0,
        storm_flag:       stormFlag(lead.stateFull),
        facebook_followers: r.facebook_followers ?? '',
        confidence:       r.confidence,
        lead_score:       score,
        score_reason:     reason,
        google_maps_url:  lead.google_maps_url || '',
        industry:         INDUSTRY.label,
        notes:            r.notes          || '',
        status:           'new',
        lead_id:          `GM-${Date.now()}-${Math.random().toString(36).substr(2,4).toUpperCase()}`,
        stateFull:        lead.stateFull,
      });
      const ln = r.lastName ? ` ${r.lastName}` : '';
      console.log(`  [${String(idx+1).padStart(3)}/${leads.length}] ${label} ✅ ${r.firstName}${ln} [${r.confidence}] score:${score} __NAMED__:${named.length}`);

      // Checkpoint every 20 leads or on lead 1
      if (named.length === 1 || named.length % 20 === 0) saveExcel(named);
    }

    if (i + CONFIG.BATCH_SIZE < leads.length) await delay(CONFIG.BATCH_DELAY);
  }

  // PHASE 4 — sort full pool by score, cut to best TARGET
  named.sort((a, b) => b.lead_score - a.lead_score);
  const final = named.slice(0, TARGET);
  console.log(`\n📊  ${named.length} leads enriched → top ${final.length} selected by score`);
  console.log(`__POOL__:${named.length}:${final.length}`);
  saveExcel(final);

  // Save seen companies so next run skips them
  const newKeys = final.map(l => (l.company_domain || l.company_name || '').toLowerCase().trim()).filter(Boolean);
  appendSeen(newKeys);
  console.log(`✅  ${newKeys.length} companies added to seen list (total: ${seenCompanies.size + newKeys.length})`);
  console.log(`\n📁  File: ${CONFIG.OUTPUT_FILE}\n`);
}

run().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
