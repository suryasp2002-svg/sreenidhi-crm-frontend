// Utilities to generate unique, readable test data for forms (Admin-only use)

function shortId(len = 4) {
  return Math.random().toString(36).slice(2, 2 + len).toUpperCase();
}

export function uniqueSeed(prefix = 'AUTO') {
  const ts = Date.now().toString(36).toUpperCase();
  return `${prefix}-${ts}-${shortId(3)}`;
}

export function fakeCompany(seed) {
  const base = seed.replace(/[^A-Z0-9]+/gi, ' ').trim();
  return `${base} Co.`;
}

// More meaningful company names for UI demos
export function companyName(seed) {
  const brands = ['Medha', 'RenewSys', 'Zenith', 'Apex', 'Omkar', 'Kaveri', 'Triveni', 'Shakti', 'Nexus', 'Prime', 'Velox', 'Sunrise', 'Metro', 'Everest', 'GreenLeaf'];
  const sectors = ['Engineering', 'Industries', 'Logistics', 'Enterprises', 'Petroleum', 'Fuels', 'Trading', 'Power', 'Infrastructure', 'Solutions'];
  const suffixes = ['Pvt Ltd', 'India', 'Ltd', 'LLP'];
  const i1 = Math.abs(hash(seed + ':b')) % brands.length;
  const i2 = Math.abs(hash(seed + ':s')) % sectors.length;
  const i3 = Math.abs(hash(seed + ':x')) % suffixes.length;
  return `${brands[i1]} ${sectors[i2]} ${suffixes[i3]}`;
}

export function fakePerson(seed) {
  const parts = ['Ravi', 'Priya', 'Arjun', 'Neha', 'Kiran', 'Divya', 'Vikram', 'Anita'];
  const i = Math.abs(hash(seed)) % parts.length;
  return `${parts[i]} ${shortId(2)}`;
}

export function fakePhone(seed) {
  // Indian-style 10-digit starting with 9/8/7/6
  const starts = ['9', '8', '7', '6'];
  const s = starts[Math.abs(hash(seed)) % starts.length];
  let rest = '';
  for (let i = 0; i < 9; i++) rest += String((Math.abs(hash(seed + i)) + i) % 10);
  return s + rest.slice(0, 9);
}

export function fakeEmail(seed) {
  const slug = seed.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return `${slug}@example.test`;
}

export function fakeGSTIN(seed) {
  // Simple mock GSTIN (not validated): 2 letters + 10 digits + 3 letters
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const pick = (i) => letters[Math.abs(hash(seed + ':' + i)) % letters.length];
  const digits = () => String(Math.abs(hash(seed)) % 1_000_000_0000).padStart(10, '0');
  return `${pick(1)}${pick(2)}${digits()}${pick(3)}${pick(4)}${pick(5)}`;
}

export function futureDate(days = 1) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function timePlusMinutes(min = 30) {
  const d = new Date();
  d.setMinutes(d.getMinutes() + min);
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mi}`;
}

export function priceRandom(base = 50, spread = 10) {
  const delta = (Math.abs(hash(String(Math.random()))) % spread) - spread / 2;
  return Math.max(1, Math.round(base + delta));
}

export function volumeRandom(base = 5000, spread = 2000) {
  const delta = (Math.abs(hash(String(Math.random()))) % spread) - spread / 2;
  return Math.max(100, Math.round(base + delta));
}

// Purpose generator for opportunities
export function purposeForClient(seed, clientName) {
  const intents = [
    'Monthly Diesel Supply',
    'Bulk Diesel Delivery',
    'Annual Fuel Supply Agreement',
    'On-site Refueling Service',
    'Trial Diesel Delivery',
    'Emergency Fuel Support'
  ];
  const i = Math.abs(hash(seed + ':p')) % intents.length;
  const name = (clientName || '').trim();
  return name ? `${intents[i]} – ${name}` : intents[i];
}

function hash(str) {
  let h = 0;
  for (let i = 0; i < String(str).length; i++) {
    h = Math.imul(31, h) + String(str).charCodeAt(i) | 0;
  }
  return h | 0;
}
