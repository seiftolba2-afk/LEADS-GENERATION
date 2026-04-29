'use strict';
const { run } = require('./agents/agent_orchestrator');

run({
  INDUSTRY_NAME: 'HVAC',
  INDUSTRY_ID:   'HV',
  QUERIES: [
    'HVAC contractor',
    'air conditioning repair',
    'heating and cooling company',
    'AC repair service',
  ],
  OUTPUT_FILE:   'D:\\LEADS GENERATION\\SAMPLE_HVAC.xlsx',
  PROGRESS_FILE: 'D:\\LEADS GENERATION\\leads_hvac_progress.csv',
  SEEN_FILE:     'D:\\LEADS GENERATION\\seen_companies_hvac.json',
});
