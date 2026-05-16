'use strict';
// setup_keys.js — One-time script: validate hardcoded Serper keys and save live ones
// Run: node setup_keys.js

const KeyManager = require('./key_manager');

const KEYS = [
  'c21c3794e99931d1e98e28e400a63b932eee6924',
  'f71038304481e8349ce67a01cbfc9739f84616a3',
  'f7214593bd0fc35ab1f4fcd49bce360c3070d377',
  // Add more keys here as needed
];

async function main() {
  console.log(`\nValidating ${KEYS.length} Serper keys...\n`);
  let live = 0, dead = 0, quota = 0, dupe = 0, err = 0;

  for (const key of KEYS) {
    const result = await KeyManager.addKey(key);
    if      (result === 'ok')        live++;
    else if (result === 'dead')      dead++;
    else if (result === 'quota')     quota++;
    else if (result === 'duplicate') dupe++;
    else                             err++;
  }

  console.log('\n─────────────────────────────');
  console.log(`✅ Live keys:      ${live}`);
  console.log(`⏳ Quota keys:     ${quota}  (saved — will recover on monthly reset)`);
  console.log(`❌ Dead keys:      ${dead}`);
  console.log(`♻️  Duplicates:     ${dupe}`);
  console.log(`⚠️  Network errors: ${err}`);
  console.log('─────────────────────────────');
  if (live > 0) console.log(`\nRun the aggregator now with: node YassinMarzouk.js\n`);
  else          console.log(`\n⚠️  No live keys. Add new Serper keys or wait for quota reset.\n`);
}

main().catch(console.error);
