// ════════════════════════════════════════════════════════════════
//  TurfBuddie — Node.js / Express  ·  Google Sheets backend
// ════════════════════════════════════════════════════════════════
const express        = require('express');
const path           = require('path');
const fs             = require('fs');
const { v4: uuidv4 } = require('uuid');
const { google }     = require('googleapis');

const app  = express();
const PORT = process.env.PORT || 3000;

const SPREADSHEET_ID   = process.env.SPREADSHEET_ID   || '';
const RAZORPAY_KEY     = process.env.RAZORPAY_KEY     || '';
const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY || 'AIzaSyAF3ATt098_yJz4tNE_5aa4ZP9Mmcypcfk';
const MAPS_API_KEY     = process.env.MAPS_API_KEY     || '';

// ── Tab definitions ────────────────────────────────────────────
const TABS = {
  Turf_Master:  ['Turf_ID','Name','Location','Base_Price','Open_Time','Close_Time','Status','Image_URL','Lat','Lng','Rating','Review_Count'],
  Bookings:     ['Booking_ID','Timestamp','User_Name','Phone','Email','Turf_ID','Date','Time_Slot','Amount','Booking_Status','Razorpay_Payment_ID'],
  Users:        ['Email','Name','Phone','City','Created_At','Last_Updated'],
  Reservations: ['Reservation_ID','Turf_ID','Date','Slots','ExpiresAt'],
};

const SAMPLE_TURFS = [
  ['T001','Green Arena','Nagpur, Maharashtra','800','06:00','22:00','Active','https://images.unsplash.com/photo-1529900748604-07564a03e7a6?w=800&q=80,https://images.unsplash.com/photo-1459865264687-595d652de67e?w=800&q=80','21.1458','79.0882','4.5','28'],
  ['T002','Champion Fields','Pune, Maharashtra','1000','05:00','23:00','Active','https://images.unsplash.com/photo-1459865264687-595d652de67e?w=800&q=80','18.5204','73.8567','4.2','15'],
  ['T003','Victory Turf','Mumbai, Maharashtra','1200','06:00','22:00','Active','https://images.unsplash.com/photo-1522778119026-d647f0596c20?w=800&q=80,https://images.unsplash.com/photo-1574629810360-7efbbe195018?w=800&q=80','19.0760','72.8777','4.8','43'],
  ['T004','Premier Pitch','Nashik, Maharashtra','700','07:00','21:00','Active','https://images.unsplash.com/photo-1529900748604-07564a03e7a6?w=800&q=80','19.9975','73.7898','3.9','9'],
  ['T005','SportsZone Elite','Aurangabad, Maharashtra','900','06:00','23:00','Active','https://images.unsplash.com/photo-1574629810360-7efbbe195018?w=800&q=80','19.8762','75.3433','4.3','21'],
];

// ── Google Auth ────────────────────────────────────────────────
function getAuth() {
  let credentials;
  if (process.env.GOOGLE_SERVICE_ACCOUNT) {
    credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
  } else if (process.env.GOOGLE_KEY_FILE) {
    credentials = JSON.parse(fs.readFileSync(process.env.GOOGLE_KEY_FILE, 'utf8'));
  } else {
    throw new Error('Set GOOGLE_SERVICE_ACCOUNT or GOOGLE_KEY_FILE env var.');
  }
  return new google.auth.GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
}
function sheets() { return google.sheets({ version: 'v4', auth: getAuth() }); }

// ── Auto-create missing tabs on startup ────────────────────────
async function ensureTabs() {
  const sh       = sheets();
  const meta     = await sh.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const existing = meta.data.sheets.map(s => s.properties.title);
  const missing  = Object.keys(TABS).filter(t => !existing.includes(t));

  if (missing.length) {
    await sh.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { requests: missing.map(t => ({ addSheet: { properties: { title: t } } })) },
    });
    console.log(`  📋 Created tabs: ${missing.join(', ')}`);
  }

  // Write headers (and sample turfs) for any tab that is completely empty
  for (const tabName of Object.keys(TABS)) {
    const headers = TABS[tabName];
    // Use a safe range to avoid "Unable to parse range" on brand-new tabs
    const res = await sh.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${tabName}!A1:A1`,
    }).catch(() => ({ data: { values: [] } }));

    const firstCell = (res.data.values || [])[0]?.[0] || '';
    if (!firstCell) {
      const rows = [headers];
      if (tabName === 'Turf_Master') rows.push(...SAMPLE_TURFS);
      await sh.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${tabName}!A1`,
        valueInputOption: 'RAW',
        requestBody: { values: rows },
      });
      console.log(`  ✅ ${tabName}: headers written${tabName === 'Turf_Master' ? ' + 5 sample turfs' : ''}`);
    }
  }
}

// ── Sheet helpers ──────────────────────────────────────────────
// Returns [] gracefully if tab is empty or missing
async function readSheet(tabName) {
  try {
    const res  = await sheets().spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: tabName });
    const rows = res.data.values || [];
    if (rows.length < 1) return [];
    const headers = rows[0];
    return rows.slice(1).map(row => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = row[i] !== undefined ? row[i] : ''; });
      return obj;
    });
  } catch (e) {
    // "Unable to parse range" or "No values" → treat as empty, not a crash
    if (e.message && (e.message.includes('Unable to parse range') || e.code === 400)) return [];
    throw e;
  }
}

async function appendRow(tabName, headers, obj) {
  const row = headers.map(h => obj[h] !== undefined ? String(obj[h]) : '');
  await sheets().spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${tabName}!A1`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [row] },
  });
}

async function updateCell(tabName, rowIndex, colIndex, value) {
  const sheetRow = rowIndex + 2; // +1 header +1 for 1-based
  const sheetCol = String.fromCharCode(65 + colIndex);
  await sheets().spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${tabName}!${sheetCol}${sheetRow}`,
    valueInputOption: 'RAW',
    requestBody: { values: [[String(value)]] },
  });
}

async function updateRow(tabName, rowIndex, headers, obj) {
  const sheetRow = rowIndex + 2;
  const row = headers.map(h => obj[h] !== undefined ? String(obj[h]) : '');
  await sheets().spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${tabName}!A${sheetRow}`,
    valueInputOption: 'RAW',
    requestBody: { values: [row] },
  });
}

// ── Misc helpers ───────────────────────────────────────────────
function generateSlots(openHour, closeHour) {
  const slots = [];
  for (let h = Number(openHour); h < Number(closeHour); h++)
    slots.push(`${String(h).padStart(2,'0')}:00 - ${String(h+1).padStart(2,'0')}:00`);
  return slots;
}
function toHour(val)  { return parseInt(String(val || '0').split(':')[0], 10) || 0; }
function todayStr()   { return new Date().toISOString().split('T')[0]; }

// ── Middleware ─────────────────────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ══════════════════════════════════════════════════════════════
//  API ROUTES
// ══════════════════════════════════════════════════════════════

app.get('/api/config', (_req, res) =>
  res.json({ success: true, razorpayKey: RAZORPAY_KEY, firebaseApiKey: FIREBASE_API_KEY, mapsApiKey: MAPS_API_KEY })
);

app.get('/api/turfs', async (_req, res) => {
  try {
    const rows  = await readSheet('Turf_Master');
    const turfs = rows.filter(t => String(t.Status).trim() === 'Active').map(t => ({
      Turf_ID:      String(t.Turf_ID).trim(),
      Name:         String(t.Name).trim(),
      Location:     String(t.Location).trim(),
      Base_Price:   Number(t.Base_Price) || 0,
      Open_Time:    toHour(t.Open_Time),
      Close_Time:   toHour(t.Close_Time),
      Status:       'Active',
      Image_URL:    String(t.Image_URL || '').trim(),
      Lat:          Number(t.Lat) || 0,
      Lng:          Number(t.Lng) || 0,
      Rating:       Number(t.Rating) || 0,
      Review_Count: Number(t.Review_Count) || 0,
    }));
    res.json({ success: true, turfs });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

app.post('/api/availability', async (req, res) => {
  try {
    const { turfId, date } = req.body;
    const [turfRows, bookingRows, resRows] = await Promise.all([
      readSheet('Turf_Master'), readSheet('Bookings'), readSheet('Reservations'),
    ]);

    const turf = turfRows.find(t => String(t.Turf_ID).trim() === turfId);
    if (!turf) return res.json({ success: false, message: 'Turf not found' });

    const slots = generateSlots(toHour(turf.Open_Time), toHour(turf.Close_Time));
    const now   = Date.now();

    const bookedSlots = bookingRows
      .filter(b => String(b.Turf_ID).trim() === turfId && String(b.Date).trim() === date && String(b.Booking_Status).trim() !== 'Cancelled')
      .flatMap(b => String(b.Time_Slot).split('|').map(s => s.trim()));

    const reservedSlots = resRows
      .filter(r => String(r.Turf_ID).trim() === turfId && String(r.Date).trim() === date && Number(r.ExpiresAt) > now)
      .flatMap(r => String(r.Slots).split('|').map(s => s.trim()));

    res.json({ success: true, slots: slots.map(slot => ({
      slot,
      status: bookedSlots.includes(slot) ? 'booked' : reservedSlots.includes(slot) ? 'reserved' : 'available',
    }))});
  } catch (e) { res.json({ success: false, message: e.message }); }
});

app.post('/api/reserve', async (req, res) => {
  try {
    const { turfId, date, slots } = req.body;
    const [bookingRows, resRows]  = await Promise.all([readSheet('Bookings'), readSheet('Reservations')]);
    const now = Date.now();

    const bookedSlots = bookingRows
      .filter(b => String(b.Turf_ID).trim() === turfId && String(b.Date).trim() === date && String(b.Booking_Status).trim() !== 'Cancelled')
      .flatMap(b => String(b.Time_Slot).split('|').map(s => s.trim()));

    const reservedSlots = resRows
      .filter(r => String(r.Turf_ID).trim() === turfId && String(r.Date).trim() === date && Number(r.ExpiresAt) > now)
      .flatMap(r => String(r.Slots).split('|').map(s => s.trim()));

    for (const slot of slots) {
      if (bookedSlots.includes(slot))   return res.json({ success: false, message: `Slot ${slot} is already booked.` });
      if (reservedSlots.includes(slot)) return res.json({ success: false, message: `Slot ${slot} is reserved by another user.` });
    }

    const reservationId = `RES-${uuidv4().slice(0,8).toUpperCase()}`;
    const expiresAt     = now + 5 * 60 * 1000;
    await appendRow('Reservations', TABS.Reservations, {
      Reservation_ID: reservationId, Turf_ID: turfId, Date: date,
      Slots: slots.join('|'), ExpiresAt: String(expiresAt),
    });
    res.json({ success: true, reservationId, expiresAt });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

app.post('/api/release', async (req, res) => {
  try {
    const { reservationId } = req.body;
    const rows = await readSheet('Reservations');
    const idx  = rows.findIndex(r => String(r.Reservation_ID).trim() === reservationId);
    if (idx >= 0) await updateCell('Reservations', idx, TABS.Reservations.indexOf('ExpiresAt'), '0');
    res.json({ success: true });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

app.post('/api/booking/create', async (req, res) => {
  try {
    const { turfId, date, slots, userName, phone, email, amount, reservationId, razorpayPaymentId } = req.body;

    // Re-verify slots haven't been taken
    const bookingRows = await readSheet('Bookings');
    const bookedSlots = bookingRows
      .filter(b => String(b.Turf_ID).trim() === turfId && String(b.Date).trim() === date && String(b.Booking_Status).trim() !== 'Cancelled')
      .flatMap(b => String(b.Time_Slot).split('|').map(s => s.trim()));
    for (const slot of slots) {
      if (bookedSlots.includes(slot)) return res.json({ success: false, message: `Slot ${slot} was just taken.` });
    }

    const bookingId = `BKG-${Date.now().toString(36).toUpperCase()}-${uuidv4().slice(0,4).toUpperCase()}`;
    const now       = new Date().toISOString();

    await appendRow('Bookings', TABS.Bookings, {
      Booking_ID: bookingId, Timestamp: now, User_Name: userName, Phone: phone, Email: email,
      Turf_ID: turfId, Date: date, Time_Slot: slots.join('|'), Amount: String(amount),
      Booking_Status: 'Confirmed', Razorpay_Payment_ID: razorpayPaymentId || '',
    });

    // Expire the reservation
    if (reservationId) {
      const resRows = await readSheet('Reservations');
      const rIdx    = resRows.findIndex(r => String(r.Reservation_ID).trim() === reservationId);
      if (rIdx >= 0) await updateCell('Reservations', rIdx, TABS.Reservations.indexOf('ExpiresAt'), '0');
    }

    // Upsert user
    const userRows = await readSheet('Users');
    const uIdx     = userRows.findIndex(u => (u.Email || '').toLowerCase() === email.toLowerCase());
    if (uIdx >= 0) {
      await updateRow('Users', uIdx, TABS.Users,
        { ...userRows[uIdx], Name: userName || userRows[uIdx].Name, Phone: phone || userRows[uIdx].Phone, Last_Updated: now });
    } else {
      await appendRow('Users', TABS.Users,
        { Email: email, Name: userName, Phone: phone, City: '', Created_At: now, Last_Updated: now });
    }

    res.json({ success: true, bookingId });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

app.post('/api/bookings', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.json({ success: false, message: 'Email required' });

    const [bookingRows, turfRows] = await Promise.all([readSheet('Bookings'), readSheet('Turf_Master')]);
    const today   = todayStr();
    const turfMap = {};
    turfRows.forEach(t => { turfMap[String(t.Turf_ID).trim()] = t; });

    const bookings = bookingRows
      .filter(b => (b.Email || '').toLowerCase() === email.toLowerCase())
      .map(b => {
        let status = String(b.Booking_Status).trim();
        if (status === 'Confirmed' && String(b.Date).trim() < today) status = 'Completed';
        const turf = turfMap[String(b.Turf_ID).trim()] || { Name: 'Unknown', Location: '', Image_URL: '' };
        return {
          Booking_ID:    String(b.Booking_ID).trim(),
          Timestamp:     String(b.Timestamp),
          Turf_ID:       String(b.Turf_ID).trim(),
          Turf_Name:     String(turf.Name || ''),
          Turf_Location: String(turf.Location || ''),
          Turf_Image:    String(turf.Image_URL || '').split(',')[0].trim(),
          Date:          String(b.Date).trim(),
          Time_Slot:     String(b.Time_Slot).trim(),
          Amount:        Number(b.Amount) || 0,
          Status:        status,
          Payment_ID:    String(b.Razorpay_Payment_ID || ''),
        };
      })
      .sort((a, b) => (a.Booking_ID > b.Booking_ID ? -1 : 1));

    res.json({ success: true, bookings });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

app.post('/api/booking/cancel', async (req, res) => {
  try {
    const { bookingId, email } = req.body;
    const rows = await readSheet('Bookings');
    const idx  = rows.findIndex(b => String(b.Booking_ID).trim() === bookingId);
    if (idx < 0) return res.json({ success: false, message: 'Booking not found.' });
    const b = rows[idx];
    if ((b.Email || '').toLowerCase() !== email.toLowerCase())
      return res.json({ success: false, message: 'Not authorised.' });
    if (String(b.Date).trim() < todayStr())
      return res.json({ success: false, message: 'Cannot cancel past bookings.' });
    await updateCell('Bookings', idx, TABS.Bookings.indexOf('Booking_Status'), 'Cancelled');
    res.json({ success: true });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

app.get('/api/profile', async (req, res) => {
  try {
    const email = (req.query.email || '').trim().toLowerCase();
    if (!email) return res.json({ success: false, message: 'Email required' });
    const rows = await readSheet('Users');
    const user = rows.find(u => (u.Email || '').toLowerCase() === email);
    res.json({ success: true, profile: user
      ? { Name: user.Name, Email: user.Email, Phone: user.Phone, City: user.City }
      : null });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

app.post('/api/profile/save', async (req, res) => {
  try {
    const { email, name, phone, city } = req.body;
    if (!email) return res.json({ success: false, message: 'Email required' });
    const now  = new Date().toISOString();
    const rows = await readSheet('Users');
    const idx  = rows.findIndex(u => (u.Email || '').toLowerCase() === email.toLowerCase());
    if (idx >= 0) {
      await updateRow('Users', idx, TABS.Users,
        { ...rows[idx], Name: name, Phone: phone, City: city, Last_Updated: now });
    } else {
      await appendRow('Users', TABS.Users,
        { Email: email, Name: name, Phone: phone, City: city, Created_At: now, Last_Updated: now });
    }
    res.json({ success: true });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ══════════════════════════════════════════════════════════════
//  STARTUP
// ══════════════════════════════════════════════════════════════
if (!SPREADSHEET_ID) {
  console.error('\n❌  SPREADSHEET_ID env var is not set. Check your .env file.\n');
  process.exit(1);
}

console.log('\n🔧 Checking Google Sheet tabs…');
ensureTabs()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`\n🟢 TurfBuddie running at http://localhost:${PORT}`);
      console.log(`   Sheet    : https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}`);
      console.log(`   Razorpay : ${RAZORPAY_KEY ? 'configured' : 'demo mode (no key)'}`);
      console.log(`   Firebase : ${FIREBASE_API_KEY ? 'configured' : 'not set'}\n`);
    });
  })
  .catch(err => {
    console.error('\n❌  Failed to connect to Google Sheets:', err.message);
    console.error('   Check SPREADSHEET_ID and your service account credentials.\n');
    process.exit(1);
  });
