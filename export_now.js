const { loadLeadsProgress } = require('./db.js');
const { saveExcel } = require('./agents/agent_output.js');

const config = {
  INDUSTRY_NAME: 'Solar',
  INDUSTRY_ID: 'SL',
  OUTPUT_FILE: 'D:\\LEADS GENERATION\\ALL_SOLAR.xlsx',
};

const { leads } = loadLeadsProgress('SL');
const namedLeads = leads.filter(l => l.full_name);

namedLeads.sort((a, b) => b.lead_score - a.lead_score);

// The split logic is now handled entirely inside saveExcel() using Elite Master Format.
// So we just pass an empty hotLeads array and all namedLeads as allLeads.
saveExcel(config, namedLeads, [], 'Solar');
console.log('Exported successfully to ALL_SOLAR.xlsx');
