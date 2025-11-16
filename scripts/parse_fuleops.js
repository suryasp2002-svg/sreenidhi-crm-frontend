const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');

const workbookPath = path.resolve(__dirname, '..', 'fuleops logic sheet.xlsx');
const outDir = path.resolve(__dirname, '..', 'tmp');
if (!fs.existsSync(workbookPath)) {
  console.error('Workbook not found:', workbookPath);
  process.exit(2);
}
try {
  const wb = xlsx.readFile(workbookPath, { cellDates: true });
  const out = {};
  wb.SheetNames.forEach(name => {
    const sheet = wb.Sheets[name];
    const rows = xlsx.utils.sheet_to_json(sheet, { defval: null });
    out[name] = rows;
  });
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'fuleops_parsed.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
  console.log('Wrote parsed JSON to', outPath);
} catch (e) {
  console.error('Failed to parse workbook:', e.message);
  process.exit(3);
}
