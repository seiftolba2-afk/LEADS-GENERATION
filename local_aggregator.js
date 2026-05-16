'use strict';
const { run } = require('./agents/agent_orchestrator');

run({
  INDUSTRY_NAME: 'Roofing',
  INDUSTRY_ID:   'RF',
  QUERIES: [
    'residential roofing contractor',
    'roof repair service',
    'local roofing company',
    'roof replacement contractor',
  ],
  OUTPUT_FILE:   require('path').join(__dirname, 'out', 'Roofing.xlsx'),
  PROGRESS_FILE: 'D:\\LEADS GENERATION\\leads_progress.csv',
  SEEN_FILE:     'D:\\LEADS GENERATION\\seen_companies.json',
});
