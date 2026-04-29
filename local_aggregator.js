'use strict';
const { run } = require('./aggregator_core');

run({
  INDUSTRY_NAME: 'Roofing',
  INDUSTRY_ID:   'RF',
  QUERIES: [
    'roofing contractors',
    'roofing company',
    'roof repair',
    'roofing services',
  ],
  OUTPUT_FILE:   'D:\\LEADS GENERATION\\SAMPLE.xlsx',
  PROGRESS_FILE: 'D:\\LEADS GENERATION\\leads_progress.csv',
  SEEN_FILE:     'D:\\LEADS GENERATION\\seen_companies.json',
});
