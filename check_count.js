const { loadLeadsProgress } = require('./db.js');
const { leads } = loadLeadsProgress('SL');
const namedLeads = leads.filter(l => l.full_name);
console.log(`Total Leads Processed: ${leads.length}`);
console.log(`Named Leads Found: ${namedLeads.length} / 400`);
