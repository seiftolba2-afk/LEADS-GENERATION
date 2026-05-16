'use strict';
const { run } = require('./agents/agent_orchestrator');

run({
  INDUSTRY_NAME: 'Electrical',
  INDUSTRY_ID:   'EL',
  QUERIES: [
    'electrician',
    'electrical contractor',
    'electrical company',
    'residential electrician',
  ],
  OUTPUT_FILE:   require('path').join(__dirname, 'out', 'Electrical.xlsx'),
  PROGRESS_FILE: 'D:\\LEADS GENERATION\\leads_electrical_progress.csv',
  SEEN_FILE:     'D:\\LEADS GENERATION\\seen_companies_electrical.json',
});
