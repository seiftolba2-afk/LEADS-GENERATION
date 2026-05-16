'use strict';
const { run } = require('./agents/agent_orchestrator');

run({
  INDUSTRY_NAME: 'Plumbing',
  INDUSTRY_ID:   'PL',
  QUERIES: [
    'plumbing contractor',
    'plumber',
    'plumbing company',
    'drain cleaning service',
  ],
  OUTPUT_FILE:   require('path').join(__dirname, 'out', 'Plumbing.xlsx'),
  PROGRESS_FILE: 'D:\\LEADS GENERATION\\leads_plumbing_progress.csv',
  SEEN_FILE:     'D:\\LEADS GENERATION\\seen_companies_plumbing.json',
});
