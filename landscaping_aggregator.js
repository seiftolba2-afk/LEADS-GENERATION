'use strict';
const { run } = require('./aggregator_core');

run({
  INDUSTRY_NAME: 'Landscaping',
  INDUSTRY_ID:   'LS',
  QUERIES: [
    'landscaping company',
    'lawn care service',
    'landscape contractor',
    'lawn maintenance',
  ],
  OUTPUT_FILE:   'D:\\LEADS GENERATION\\SAMPLE_LANDSCAPING.xlsx',
  PROGRESS_FILE: 'D:\\LEADS GENERATION\\leads_landscaping_progress.csv',
  SEEN_FILE:     'D:\\LEADS GENERATION\\seen_companies_landscaping.json',
});
