'use strict';
const { run } = require('./agents/agent_orchestrator');

run({
  INDUSTRY_NAME: 'Solar',
  INDUSTRY_ID:   'SL',
  QUERIES: [
    'solar panel installation',
    'solar energy company',
    'solar installer',
    'residential solar',
  ],
  OUTPUT_FILE:   'D:\\LEADS GENERATION\\SAMPLE_SOLAR.xlsx',
  PROGRESS_FILE: 'D:\\LEADS GENERATION\\leads_solar_progress.csv',
  SEEN_FILE:     'D:\\LEADS GENERATION\\seen_companies_solar.json',
});
