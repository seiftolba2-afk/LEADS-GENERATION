'use strict';
const { run } = require('./agents/agent_orchestrator');

run({
  INDUSTRY_NAME: 'Solar',
  INDUSTRY_ID:   'SL',
  QUERIES: [
    'residential solar installer',
    'solar panel installation company',
    'home solar system installer',
    'solar energy contractor',
  ],
  OUTPUT_FILE:   require('path').join(__dirname, 'out', 'Solar.xlsx'),
  PROGRESS_FILE: 'D:\\LEADS GENERATION\\leads_solar_progress.csv',
  SEEN_FILE:     'D:\\LEADS GENERATION\\seen_companies_solar.json',
});
