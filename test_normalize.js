const lev = require('fast-levenshtein');
function normalizeCo(name) {
  return (name || '').toLowerCase()
    .replace(/,?\s*(architecture|landscaping|contracting|electrical|decoration|architects|designers|plumbing|services|painting|interior|designer|roofing|architect|furniture|company|studio|design|decor|group|solar|hvac|corp|inc|llc|ltd|co|للديكور|للتصميم|الداخلي)\.?/gi, '')
    .replace(/[^\p{L}\p{N}]/gu, '').trim();
}
console.log('1.', normalizeCo('شركة مصر للتصميم الداخلي LLC'));
console.log('2.', normalizeCo('The Best Interior Design Co.'));
console.log('3.', normalizeCo('احمد للديكور'));
console.log('4.', normalizeCo('123 Solar Company'));
