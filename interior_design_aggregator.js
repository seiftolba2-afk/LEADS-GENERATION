'use strict';
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // local CA not trusted by Node — needed for HTTPS on this machine
const { run } = require('./agents/agent_orchestrator');

run({
  INDUSTRY_NAME: 'Interior Design',
  INDUSTRY_ID:   'ID',
  QUERIES: [
    'interior design company',
    'interior designer',
    'home decor design company',
    'interior decoration company',
  ],
  OUTPUT_FILE:   require('path').join(__dirname, 'out', 'Kareem Tolba.xlsx'),
  PROGRESS_FILE: require('path').join(__dirname, 'leads_id_progress.csv'),
  SEEN_FILE:     require('path').join(__dirname, 'seen_companies_id.json'),

  // Target: 100 leads total (no hot/all split needed for this client)
  HOT_COUNT:   100,
  ALL_COUNT:   0,
  FIXED_COUNTS: true,

  // Source Quotas: Instagram only
  SOURCE_QUOTAS: {
    google_maps: 0,
    facebook: 0,
    instagram: 100,
  },

  // Instagram Follower limits: 5K - 10K
  INSTAGRAM_MIN_FOLLOWERS: 5000,
  INSTAGRAM_MAX_FOLLOWERS: 10000,

  // Cairo only for this run
  CITIES: require('./cities').filter(c => c.city === 'Cairo'),

  // Skip US-only waterfall layers — they burn Serper credits with zero yield for Egypt
  SKIP_LAYERS: new Set(['L2c:Manta', 'L2d:Porch', 'L4:LicenseDB', 'L5:BBB', 'L6:OpenCorp', 'L7:Angi', 'L8:Houzz', 'L9:Thumbtack', 'L10:Yelp', 'L11:SOS', 'L12:TripAdvisor']),

  // Hard filter: skip any lead missing phone or Instagram profile
  REQUIRE_FIELDS: ['phone', 'instagram'],

  // Phone code for Veriphone
  COUNTRY_CODE: '+20',
});
