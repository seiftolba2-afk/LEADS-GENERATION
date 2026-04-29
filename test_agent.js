'use strict';
// Quick smoke test for agent_orchestrator — 1 city, max 5 leads
// Usage: node test_agent.js
const { run } = require('./agents/agent_orchestrator');

run({
  INDUSTRY_NAME: 'Roofing',
  INDUSTRY_ID:   'RF_TEST',
  QUERIES: [
    'roofing contractors',
    'roofing company',
  ],
  HOT_COUNT:     3,
  ALL_COUNT:     2,
  CITIES: [
    { city: 'Austin', state: 'TX', stateFull: 'Texas' },
  ],
  OUTPUT_FILE:   'D:\\LEADS GENERATION\\TEST_OUTPUT.xlsx',
  PROGRESS_FILE: 'D:\\LEADS GENERATION\\test_progress.csv',
  SEEN_FILE:     'D:\\LEADS GENERATION\\seen_companies_test.json',
});
