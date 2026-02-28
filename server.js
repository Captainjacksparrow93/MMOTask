const path = require('path');

// ── Load .env (tries __dirname first, then cwd as fallback) ──────────────────
let dotenvResult = require('dotenv').config({ path: path.resolve(__dirname, '.env') });
if (dotenvResult.error) {
  dotenvResult = require('dotenv').config({ path: path.resolve(process.cwd(), '.env') });
}

const express = require('express');
const cors    = require('cors');

const app = express();

// ── Startup diagnostic ────────────────────────────────────────────────────────
console.log('\n── Env check ──────────────────────────────────────');
console.log('  App folder   :', __dirname);
console.log('  Working dir  :', process.cwd());
console.log('  .env loaded  :', dotenvResult.error ? '❌ NOT FOUND' : '✅ OK');
console.log('  DB_HOST      :', process.env.DB_HOST     || '(not set)');
console.log('  DB_USER      :', process.env.DB_USER     || '(not set)');
console.log('  DB_PASSWORD  :', process.env.DB_PASSWORD ? '(set ✅)' : '(not set ❌)');
console.log('  DB_NAME      :', process.env.DB_NAME     || '(not set)');
console.log('───────────────────────────────────────────────────\n');

// ── DB readiness flag ─────────────────────────────────────────────────────────
let dbReady  = false;
let dbError  = 'Connecting to database…';

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Debug page — visit /debug-env in browser to see config status ─────────────
app.get('/debug-env', (_req, res) => {
  res.send(`
    <html><head><meta charset="utf-8">
    <style>body{font-family:monospace;padding:30px;background:#1a1a2e;color:#e2e8f0}
    h2{color:#6366f1} .ok{color:#22c55e} .err{color:#ef4444} .warn{color:#f59e0b}
    table{border-collapse:collapse;width:100%} td{padding:6px 14px;border-bottom:1px solid #334155}
    </style></head><body>
    <h2>TaskFlow — Environment Diagnostics</h2>
    <table>
      <tr><td>DB Ready</td><td class="${dbReady ? 'ok' : 'err'}">${dbReady ? '✅ Connected' : '❌ ' + dbError}</td></tr>
      <tr><td>DB_HOST</td><td class="${process.env.DB_HOST ? 'ok' : 'err'}">${process.env.DB_HOST || '❌ not set'}</td></tr>
      <tr><td>DB_PORT</td><td class="${process.env.DB_PORT ? 'ok' : 'warn'}">${process.env.DB_PORT || '⚠️ not set (using 3306)'}</td></tr>
      <tr><td>DB_USER</td><td class="${process.env.DB_USER ? 'ok' : 'err'}">${process.env.DB_USER || '❌ not set'}</td></tr>
      <tr><td>DB_PASSWORD</td><td class="${process.env.DB_PASSWORD ? 'ok' : 'err'}">${process.env.DB_PASSWORD ? '✅ set' : '❌ not set'}</td></tr>
      <tr><td>DB_NAME</td><td class="${process.env.DB_NAME ? 'ok' : 'err'}">${process.env.DB_NAME || '❌ not set'}</td></tr>
      <tr><td>JWT_SECRET</td><td class="${process.env.JWT_SECRET ? 'ok' : 'warn'}">${process.env.JWT_SECRET ? '✅ set' : '⚠️ not set'}</td></tr>
      <tr><td>.env loaded</td><td class="${dotenvResult.error ? 'warn' : 'ok'}">${dotenvResult.error ? '⚠️ No .env file (must use hPanel env vars)' : '✅ .env file loaded'}</td></tr>
      <tr><td>App folder</td><td>${__dirname}</td></tr>
      <tr><td>Working dir</td><td>${process.cwd()}</td></tr>
    </table>
    <p style="color:#64748b;margin-top:20px">Refresh this page after changing env vars and restarting the app.</p>
    </body></html>
  `);
});

// ── Health-check ──────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok', db: dbReady }));

// ── DB-ready guard — all /api routes return 503 JSON until DB is connected ────
app.use('/api', (_req, res, next) => {
  if (!dbReady) {
    return res.status(503).json({
      error: 'Database not connected — ' + dbError,
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

// ── Connect to DB with auto-retry ─────────────────────────────────────────────
const { initDatabase } = require('./database/db');
const RETRY_DELAY_MS   = 5000;
const MAX_RETRIES      = 10;

async function connectDb(attempt = 1) {
  try {
    await initDatabase();
    dbReady = true;
    dbError = '';
    console.log('✅ Database connected and ready');
    console.log('📧 Default Admin → dhruv@monkmediaone.com / MMO@1993#');
  } catch (err) {
    dbError = err.message;
    console.error(`❌ DB attempt ${attempt} failed: ${err.message}`);
    if (attempt < MAX_RETRIES) {
      console.log(`🔄 Retrying in ${RETRY_DELAY_MS / 1000}s… (${attempt}/${MAX_RETRIES})`);
      setTimeout(() => connectDb(attempt + 1), RETRY_DELAY_MS);
    } else {
      console.error('💀 Could not connect after', MAX_RETRIES, 'attempts. Fix DB credentials.');
    }
  }
}

// ── Start: listen directly (local/Docker) OR export for Vercel serverless ────
const PORT = process.env.PORT || 3000;
if (require.main === module) {
  // Running via `node server.js` — local dev or Docker
  app.listen(PORT, () => {
    console.log(`🚀 Server listening on port ${PORT}`);
    connectDb();
  });
} else {
  // Imported as a module by Vercel serverless — initiate DB on first module load.
  // The /api 503 guard handles requests that arrive before DB is ready.
  connectDb();
}

module.exports = app;
