// export_listing.js — builds ALL.xlsx ready for Whop/Etsy listing
const fs = require('fs');
const csv = require('csv-parser');
const XLSX = require('xlsx');

const BUYER_COLUMNS = [
  'full_name', 'job_title', 'company_name', 'company_domain',
  'phone', 'email',
  'location_city', 'location_state',
  'google_rating', 'review_count', 'lead_score'
];

const HEADERS_DISPLAY = {
  full_name: 'Owner Name',
  job_title: 'Title',
  company_name: 'Company',
  company_domain: 'Website',
  phone: 'Phone',
  email: 'Email',
  location_city: 'City',
  location_state: 'State',
  google_rating: 'Google Rating',
  review_count: 'Reviews',
  lead_score: 'Lead Score'
};

function passesFilter(r) {
  const phone = (r.phone || '').replace(/\D/g, '');
  const reviews = parseInt(r.review_count) || 0;
  const name = (r.full_name || '').trim();
  return phone.length >= 7 && reviews <= 120 && name.length > 2;
}

function loadCSV(path) {
  return new Promise((resolve, reject) => {
    const rows = [];
    if (!fs.existsSync(path)) return resolve([]);
    fs.createReadStream(path)
      .pipe(csv())
      .on('data', r => rows.push(r))
      .on('end', () => resolve(rows))
      .on('error', reject);
  });
}

async function main() {
  console.log('Reading lead files...');

  const [roofing] = await Promise.all([
    loadCSV('leads_progress.csv'),
  ]);

  const all = [...roofing];
  console.log(`Loaded ${all.length} total leads`);

  const filtered = all.filter(passesFilter);
  console.log(`After filter: ${filtered.length} qualifying leads`);

  // Sort by score desc, then by email presence (email = more value)
  filtered.sort((a, b) => {
    const scoreDiff = (parseInt(b.lead_score) || 0) - (parseInt(a.lead_score) || 0);
    if (scoreDiff !== 0) return scoreDiff;
    const aEmail = (a.email || '').length > 5 ? 1 : 0;
    const bEmail = (b.email || '').length > 5 ? 1 : 0;
    return bEmail - aEmail;
  });

  const top400 = filtered.slice(0, 400);
  console.log(`Taking top ${top400.length} leads`);

  // Build worksheet rows
  const headerRow = BUYER_COLUMNS.map(k => HEADERS_DISPLAY[k]);
  const dataRows = top400.map((r, i) => {
    return BUYER_COLUMNS.map(k => {
      if (k === 'phone') return { v: r[k] || '', t: 's', z: '@' };
      if (k === 'lead_score' || k === 'review_count') return parseInt(r[k]) || 0;
      if (k === 'google_rating') return parseFloat(r[k]) || 0;
      return r[k] || '';
    });
  });

  const wb = XLSX.utils.book_new();
  const wsData = [headerRow, ...dataRows.map(row =>
    row.map(cell => typeof cell === 'object' ? cell.v : cell)
  )];
  const ws = XLSX.utils.aoa_to_sheet(wsData);

  // Force phone column to text (column E = index 4)
  const phoneColIdx = BUYER_COLUMNS.indexOf('phone');
  const phoneColLetter = XLSX.utils.encode_col(phoneColIdx);
  for (let i = 1; i <= top400.length; i++) {
    const cellAddr = `${phoneColLetter}${i + 1}`;
    if (ws[cellAddr]) {
      ws[cellAddr].t = 's';
      ws[cellAddr].z = '@';
    }
  }

  // Column widths
  ws['!cols'] = [
    { wch: 22 }, // Owner Name
    { wch: 12 }, // Title
    { wch: 30 }, // Company
    { wch: 28 }, // Website
    { wch: 16 }, // Phone
    { wch: 30 }, // Email
    { wch: 16 }, // City
    { wch: 14 }, // State
    { wch: 13 }, // Google Rating
    { wch: 9  }, // Reviews
    { wch: 10 }, // Lead Score
  ];

  // Freeze top row
  ws['!freeze'] = { xSplit: 0, ySplit: 1 };

  XLSX.utils.book_append_sheet(wb, ws, 'ALL');

  // Stats sheet
  const withEmail = top400.filter(r => (r.email || '').length > 5).length;
  const avgScore = (top400.reduce((s, r) => s + (parseInt(r.lead_score) || 0), 0) / top400.length).toFixed(1);
  const states = [...new Set(top400.map(r => r.location_state))].filter(Boolean);
  const cities = [...new Set(top400.map(r => r.location_city))].filter(Boolean);
  const avgRating = (top400.reduce((s, r) => s + (parseFloat(r.google_rating) || 0), 0) / top400.length).toFixed(2);

  const statsData = [
    ['Metric', 'Value'],
    ['Total Leads', top400.length],
    ['Leads With Email', withEmail],
    ['Leads Phone Only', top400.length - withEmail],
    ['Average Lead Score', avgScore],
    ['Average Google Rating', avgRating],
    ['States Covered', states.length],
    ['Cities Covered', cities.length],
    ['Industry', 'Roofing Contractors'],
    ['Data Collected', 'April 2026'],
    ['', ''],
    ['States', states.join(', ')],
  ];
  const wsStats = XLSX.utils.aoa_to_sheet(statsData);
  wsStats['!cols'] = [{ wch: 22 }, { wch: 50 }];
  XLSX.utils.book_append_sheet(wb, wsStats, 'STATS');

  const outPath = 'ALL.xlsx';
  XLSX.writeFile(wb, outPath);

  console.log('\n✓ ALL.xlsx created');
  console.log(`  ${top400.length} leads — sheet: ALL`);
  console.log(`  ${withEmail} with email, ${top400.length - withEmail} phone-only`);
  console.log(`  Avg score: ${avgScore} | Avg rating: ${avgRating}`);
  console.log(`  ${states.length} states | ${cities.length} cities`);
  console.log(`\nFile ready to upload to Whop/Etsy.`);
}

main().catch(console.error);
