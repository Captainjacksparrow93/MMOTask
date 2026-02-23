require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');

const app = express();

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Health-check (Hostinger pings this to verify the process is alive) ────────
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// ── API Routes ────────────────────────────────────────────────────────────────
app.use('/api/auth',        require('./routes/auth'));
app.use('/api/users',       require('./routes/users'));
app.use('/api/tasks',       require('./routes/tasks'));
app.use('/api/task-types',  require('./routes/taskTypes'));
app.use('/api/roles',       require('./routes/roles'));
app.use('/api/dashboard',   require('./routes/dashboard'));
app.use('/api/time-logs',   require('./routes/timeLogs'));
app.use('/api/performance', require('./routes/performance'));

// ── Serve frontend SPA for all non-API routes ─────────────────────────────────
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Start HTTP server FIRST so the process stays alive ───────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🚀 Server listening on port ${PORT}`);
  connectDb();
});

// ── Connect to DB with auto-retry ─────────────────────────────────────────────
const { initDatabase } = require('./database/db');
const RETRY_DELAY_MS   = 5000;   // wait 5 s between retries
const MAX_RETRIES      = 10;

async function connectDb(attempt = 1) {
  try {
    await initDatabase();
    console.log('✅ Database connected and ready');
    console.log('📧 Default Admin → admin@agency.com / Admin@1234');
  } catch (err) {
    console.error(`❌ DB connection attempt ${attempt} failed:`, err.message);
    if (attempt < MAX_RETRIES) {
      console.log(`🔄 Retrying in ${RETRY_DELAY_MS / 1000}s… (${attempt}/${MAX_RETRIES})`);
      setTimeout(() => connectDb(attempt + 1), RETRY_DELAY_MS);
    } else {
      console.error('💀 Could not connect to the database after', MAX_RETRIES, 'attempts. Check DB env vars in Hostinger hPanel.');
    }
  }
}
