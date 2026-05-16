'use strict';
const { run } = require('./agents/agent_orchestrator');

run({
  INDUSTRY_NAME: 'HVAC',
  INDUSTRY_ID:   'HV',
  QUERIES: [
    'residential HVAC contractor',
    'air conditioning repair service',
    'local heating and cooling company',
    'AC installation contractor',
  ],
  OUTPUT_FILE:   require('path').join(__dirname, 'out', 'HVAC.xlsx'),
  PROGRESS_FILE: 'D:\\LEADS GENERATION\\leads_hvac_progress.csv',
  SEEN_FILE:     'D:\\LEADS GENERATION\\seen_companies_hvac.json',
});
