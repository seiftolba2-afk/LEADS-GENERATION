const { spawn } = require('child_process');

async function runKeygen() {
  return new Promise((resolve) => {
    console.log('\n[Monitor] Starting key_generator.js...');
    const child = spawn('node', ['agents/key_generator.js'], { stdio: 'inherit' });

    child.on('close', (code) => {
      console.log(`\n[Monitor] Script exited with code ${code}.`);
      resolve(code);
    });
  });
}

async function start() {
  let attempts = 0;
  while (true) {
    attempts++;
    console.log(`\n======================================`);
    console.log(`[Monitor] KEYGEN RUN #${attempts}`);
    console.log(`======================================`);
    
    await runKeygen();
    
    console.log('[Monitor] Restarting in 5 seconds...');
    await new Promise(r => setTimeout(r, 5000));
  }
}

start().catch(console.error);
