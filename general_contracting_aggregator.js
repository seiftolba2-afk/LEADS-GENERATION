'use strict';
const { run } = require('./agents/agent_orchestrator');

run({
  INDUSTRY_NAME: 'General Contracting',
  INDUSTRY_ID:   'GC',
  QUERIES: [
    'general contractor',
    'home remodeling contractor',
    'renovation contractor',
    'home improvement company',
  ],
  OUTPUT_FILE:   'D:\\LEADS GENERATION\\SAMPLE_GENERAL.xlsx',
  PROGRESS_FILE: 'D:\\LEADS GENERATION\\leads_general_progress.csv',
  SEEN_FILE:     'D:\\LEADS GENERATION\\seen_companies_general.json',
});
