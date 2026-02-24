const path = require('path');

// ── Load .env from the same folder as server.js (fixes Hostinger cwd issues) ─
const dotenvResult = require('dotenv').config({ path: path.resolve(__dirname, '.env') });

const express = require('express');
const cors    = require('cors');

const app = express();

// ── Startup diagnostic — confirms which DB vars are loaded ────────────────────
console.log('\n── Env check ──────────────────────────────────────');
console.log('  App folder   :', __dirname);
console.log('  .env path    :', path.resolve(__dirname, '.env'));
console.log('  .env loaded  :', dotenvResult.error ? '❌ NOT FOUND — ' + dotenvResult.error.message : '✅ OK');
console.log('  DB_HOST      :', process.env.DB_HOST      || '(not set — will default to localhost)');
console.log('  DB_PORT      :', process.env.DB_PORT      || '(not set — will default to 3306)');
console.log('  DB_USER      :', process.env.DB_USER      || '(not set — will default to root)');
console.log('  DB_PASSWORD  :', process.env.DB_PASSWORD  ? '(set ✅)' : '(not set ❌)');
console.log('  DB_NAME      :', process.env.DB_NAME      || '(not set — will default to agency_tasks)');
console.log('  JWT_SECRET   :', process.env.JWT_SECRET   ? '(set ✅)' : '(not set ❌)');
console.log('───────────────────────────────────────────────────\n');

// ── DB readiness flag ─────────────────────────────────────────────────────────
let dbReady = false;

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Health-check ──────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok', db: dbReady }));

// ── DB-ready guard — all /api routes return 503 JSON until DB is connected ────
app.use('/api', (req, res, next) => {
  if (!dbReady) {
    return res.status(503).json({
      error: 'Server is starting up — database not connected yet. Please wait a moment and try again.',
    });
  }
  next();
});

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
  console.log(`🚀 Server listening on port ${PORT}`);
  connectDb();
});

// ── Connect to DB with auto-retry ─────────────────────────────────────────────
const { initDatabase } = require('./database/db');
const RETRY_DELAY_MS   = 5000;
const MAX_RETRIES      = 10;

async function connectDb(attempt = 1) {
  try {
    await initDatabase();
    dbReady = true;
    console.log('✅ Database connected and ready');
    console.log('📧 Default Admin → dhruv@monkmediaone.com / MMO@1993#');
  } catch (err) {
    console.error(`❌ DB connection attempt ${attempt} failed:`, err.message);
    if (attempt < MAX_RETRIES) {
      console.log(`🔄 Retrying in ${RETRY_DELAY_MS / 1000}s… (${attempt}/${MAX_RETRIES})`);
      setTimeout(() => connectDb(attempt + 1), RETRY_DELAY_MS);
    } else {
      console.error('💀 Could not connect after', MAX_RETRIES, 'attempts.');
      console.error('👉 Check your .env file — DB_HOST, DB_USER, DB_PASSWORD, DB_NAME must all be set.');
    }
  }
}
