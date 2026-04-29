'use strict';
const { run } = require('./aggregator_core');

run({
  INDUSTRY_NAME: 'Painting',
  INDUSTRY_ID:   'PT',
  QUERIES: [
    'painting contractor',
    'house painter',
    'painting company',
    'interior exterior painter',
  ],
  OUTPUT_FILE:   'D:\\LEADS GENERATION\\SAMPLE_PAINTING.xlsx',
  PROGRESS_FILE: 'D:\\LEADS GENERATION\\leads_painting_progress.csv',
  SEEN_FILE:     'D:\\LEADS GENERATION\\seen_companies_painting.json',
});
