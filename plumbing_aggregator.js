'use strict';
const { run } = require('./aggregator_core');

run({
  INDUSTRY_NAME: 'Plumbing',
  INDUSTRY_ID:   'PL',
  QUERIES: [
    'plumbing contractor',
    'plumber',
    'plumbing company',
    'drain cleaning service',
  ],
  OUTPUT_FILE:   'D:\\LEADS GENERATION\\SAMPLE_PLUMBING.xlsx',
  PROGRESS_FILE: 'D:\\LEADS GENERATION\\leads_plumbing_progress.csv',
  SEEN_FILE:     'D:\\LEADS GENERATION\\seen_companies_plumbing.json',
});
