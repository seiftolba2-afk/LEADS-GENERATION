'use strict';
const https = require('https');
const fs    = require('fs');
const path  = require('path');
const { execSync } = require('child_process');

const EXT_ID  = 'dknlfmjaanfblgfdfebhijalfmhmjjjo';
const CRX_URL = `https://clients2.google.com/service/update2/crx?response=redirect&acceptformat=crx3&prodversion=124.0.6367.60&x=id%3D${EXT_ID}%26installsource%3Dondemand%26uc`;
const CRX_OUT = path.join('D:\\LEADS GENERATION', 'nopecha.crx');
const EXT_DIR = path.join('D:\\LEADS GENERATION', '.nopecha_ext');

function download(url, dest, redirects) {
  redirects = redirects || 0;
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('Too many redirects'));
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return resolve(download(res.headers.location, dest, redirects + 1));
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      const file = fs.createWriteStream(dest);
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
      file.on('error', reject);
    }).on('error', reject);
  });
}

async function main() {
  console.log('📦 Downloading NopeCHA extension CRX...');
  await download(CRX_URL, CRX_OUT);
  const size = fs.statSync(CRX_OUT).size;
  console.log(`✅ Downloaded: ${CRX_OUT} (${(size/1024).toFixed(1)} KB)`);

  if (!fs.existsSync(EXT_DIR)) fs.mkdirSync(EXT_DIR, { recursive: true });

  // CRX3 format: starts with "Cr24" magic, then has a header length field
  // We skip the CRX header and extract the embedded ZIP
  const crx = fs.readFileSync(CRX_OUT);
  const magic = crx.slice(0, 4).toString();
  if (magic !== 'Cr24') throw new Error('Not a valid CRX3 file: ' + magic);

  const version = crx.readUInt32LE(4);
  const headerLen = crx.readUInt32LE(8);
  const zipStart = 12 + headerLen;
  const zipData = crx.slice(zipStart);

  const zipPath = CRX_OUT.replace('.crx', '.zip');
  fs.writeFileSync(zipPath, zipData);
  console.log(`📂 Extracted ZIP: ${zipPath} (${(zipData.length/1024).toFixed(1)} KB)`);

  // Use PowerShell to unzip
  execSync(`powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${EXT_DIR}' -Force"`, { stdio: 'inherit' });
  console.log(`✅ NopeCHA extension extracted to: ${EXT_DIR}`);
  console.log(`\n🔑 Extension path for Playwright: ${EXT_DIR}`);
  console.log(`\nAdd to key_generator.js args:`);
  console.log(`  '--disable-extensions-except=${EXT_DIR}',`);
  console.log(`  '--load-extension=${EXT_DIR}',`);
}

main().catch(err => { console.error('❌ Error:', err.message); process.exit(1); });
