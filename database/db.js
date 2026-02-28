/**
 * database/db.js — Neon Serverless PostgreSQL
 *
 * Uses Neon's HTTP-based query API (@neondatabase/serverless).
 * No WebSocket, no TCP connections — perfect for Vercel serverless.
 * Only one env var needed: DATABASE_URL (from neon.tech dashboard).
 *
 * mysql2-compatible wrapper so route files need minimal changes:
 *   db.execute(sql, params)
 *     — ? placeholders auto-converted to $1, $2, …
 *     — SELECT / UPDATE / DELETE → [rows, null]
 *     — INSERT                  → [{ insertId, affectedRows }, null]
 *                                  (RETURNING id is appended automatically)
 */

const { neon, neonConfig } = require('@neondatabase/serverless');
const bcrypt = require('bcryptjs');

// Reuse HTTP connections within a single serverless invocation
neonConfig.fetchConnectionCache = true;

let _db = null;

// ── Synchronous getter ───────────────────────────────────────────────────────
function getDb() {
  if (!_db) throw new Error('DB not initialised — await initDatabase() first');
  return _db;
}

// ── mysql2-compatible wrapper around the neon HTTP function ──────────────────
function createDb(sqlFn) {
  async function execute(sqlStr, params = []) {
    // 1. Convert ? → $n
    let n = 0;
    const pgSql = sqlStr.replace(/\?/g, () => `$${++n}`);

    // 2. Auto-append RETURNING id to bare INSERT statements
    const isInsert = /^\s*INSERT\s+/i.test(pgSql);
    const finalSql = (isInsert && !/\bRETURNING\b/i.test(pgSql))
      ? pgSql + ' RETURNING id'
      : pgSql;

    // 3. Replace undefined with null (pg rejects undefined values)
    const safeParams = params.map(p => (p === undefined ? null : p));

    // 4. Execute via Neon HTTP API — returns plain array of row objects
    const rows = await sqlFn(finalSql, safeParams);

    // 5. Return mysql2-style tuple
    if (isInsert) {
      return [{ insertId: rows[0]?.id ?? null, affectedRows: rows.length }, null];
    }
    return [rows, null];
  }

  return {
    execute,
    query: (s, p) => sqlFn(s, p),
    // getConnection() used only during initDatabase schema work — no-op release
    async getConnection() {
      return { execute, query: (s, p) => sqlFn(s, p), release: () => {} };
    },
  };
}

// ── initDatabase — async, called once at server startup ─────────────────────
async function initDatabase() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      'DATABASE_URL is not set. ' +
      'Add it in Vercel → Settings → Environment Variables. ' +
      'Get the value from https://console.neon.tech → your project → Connection string.'
    );
  }

  const sqlFn = neon(connectionString);

  // ── Create tables (all idempotent via IF NOT EXISTS) ──────────────────────
  await sqlFn(`CREATE TABLE IF NOT EXISTS roles (
    id         SERIAL PRIMARY KEY,
    name       VARCHAR(255) NOT NULL UNIQUE,
    created_at TIMESTAMPTZ  DEFAULT NOW()
  )`);

  await sqlFn(`CREATE TABLE IF NOT EXISTS users (
    id         SERIAL PRIMARY KEY,
    name       VARCHAR(255) NOT NULL,
    email      VARCHAR(255) UNIQUE NOT NULL,
    password   VARCHAR(255) NOT NULL,
    role_id    INT  REFERENCES roles(id),
    is_admin   SMALLINT DEFAULT 0,
    is_active  SMALLINT DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`);

  await sqlFn(`CREATE TABLE IF NOT EXISTS task_types (
    id             SERIAL PRIMARY KEY,
    name           VARCHAR(255) NOT NULL,
    role_id        INT NOT NULL REFERENCES roles(id),
    daily_capacity INT DEFAULT 2,
    is_predefined  SMALLINT DEFAULT 0,
    created_at     TIMESTAMPTZ DEFAULT NOW()
  )`);

  await sqlFn(`CREATE TABLE IF NOT EXISTS tasks (
    id              SERIAL PRIMARY KEY,
    title           VARCHAR(500) NOT NULL,
    description     TEXT,
    client_name     VARCHAR(255),
    task_type_id    INT NOT NULL REFERENCES task_types(id),
    urgency         VARCHAR(50)  DEFAULT 'medium',
    deadline        DATE NOT NULL,
    buffer_deadline DATE NOT NULL,
    assigned_to     INT  REFERENCES users(id),
    status          VARCHAR(50)  DEFAULT 'pending',
    progress        INT  DEFAULT 0,
    revision_count  INT  DEFAULT 0,
    feedback_notes  TEXT,
    completed_at    TIMESTAMPTZ,
    eta             VARCHAR(255),
    created_by      INT  REFERENCES users(id),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
  )`);

  await sqlFn(`CREATE TABLE IF NOT EXISTS time_logs (
    id               SERIAL PRIMARY KEY,
    user_id          INT NOT NULL REFERENCES users(id),
    date             DATE NOT NULL,
    punch_in         TIMESTAMPTZ,
    punch_out        TIMESTAMPTZ,
    duration_minutes INT DEFAULT 0,
    UNIQUE(user_id, date)
  )`);

  await sqlFn(`CREATE TABLE IF NOT EXISTS task_time_logs (
    id            SERIAL PRIMARY KEY,
    task_id       INT NOT NULL REFERENCES tasks(id),
    user_id       INT NOT NULL REFERENCES users(id),
    started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at      TIMESTAMPTZ,
    duration_secs INT DEFAULT 0
  )`);

  // ── Auto-update updated_at trigger ────────────────────────────────────────
  await sqlFn(`
    CREATE OR REPLACE FUNCTION update_updated_at()
    RETURNS TRIGGER AS $$
    BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
    $$ LANGUAGE plpgsql
  `);
  await sqlFn(`DROP TRIGGER IF EXISTS tasks_updated_at ON tasks`);
  await sqlFn(`
    CREATE TRIGGER tasks_updated_at
      BEFORE UPDATE ON tasks
      FOR EACH ROW EXECUTE FUNCTION update_updated_at()
  `);

  // ── Idempotent column additions (safe on pre-existing databases) ──────────
  const alterCols = [
    { table: 'tasks', col: 'progress',       def: 'INT DEFAULT 0' },
    { table: 'tasks', col: 'revision_count', def: 'INT DEFAULT 0' },
    { table: 'tasks', col: 'feedback_notes', def: 'TEXT'          },
    { table: 'tasks', col: 'completed_at',   def: 'TIMESTAMPTZ'   },
    { table: 'tasks', col: 'eta',            def: 'VARCHAR(255)'  },
  ];
  for (const { table, col, def } of alterCols) {
    await sqlFn(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${col} ${def}`);
  }

  // ── Seed on first run ─────────────────────────────────────────────────────
  const countRows = await sqlFn('SELECT COUNT(*) AS cnt FROM roles');
  if (Number(countRows[0].cnt) === 0) await seedData(sqlFn);

  _db = createDb(sqlFn);
  console.log('✅ Database ready (Neon PostgreSQL)');
}

// ── Seed default data ────────────────────────────────────────────────────────
async function seedData(sqlFn) {
  const roleNames = ['Designer', 'Video Editor', 'Content Writer', 'Social Media Manager'];
  const roleIds   = {};

  for (const name of roleNames) {
    const rows = await sqlFn('INSERT INTO roles (name) VALUES ($1) RETURNING id', [name]);
    roleIds[name] = rows[0].id;
  }

  const taskTypes = [
    { name: 'Graphic Design',    role: 'Designer',             capacity: 2 },
    { name: 'Ad Creative',       role: 'Designer',             capacity: 2 },
    { name: 'Story Design',      role: 'Designer',             capacity: 4 },
    { name: 'Email Template',    role: 'Designer',             capacity: 2 },
    { name: 'Reels',             role: 'Video Editor',         capacity: 4 },
    { name: 'Video Editing',     role: 'Video Editor',         capacity: 2 },
    { name: 'Content Writing',   role: 'Content Writer',       capacity: 4 },
    { name: 'Blog Post',         role: 'Content Writer',       capacity: 2 },
    { name: 'Caption Writing',   role: 'Content Writer',       capacity: 6 },
    { name: 'Social Media Post', role: 'Social Media Manager', capacity: 6 },
    { name: 'Campaign Planning', role: 'Social Media Manager', capacity: 2 },
  ];

  for (const tt of taskTypes) {
    await sqlFn(
      'INSERT INTO task_types (name, role_id, daily_capacity, is_predefined) VALUES ($1, $2, $3, 1)',
      [tt.name, roleIds[tt.role], tt.capacity]
    );
  }

  const hashed = await bcrypt.hash('MMO@1993#', 10);
  await sqlFn(
    'INSERT INTO users (name, email, password, is_admin) VALUES ($1, $2, $3, 1)',
    ['Admin', 'dhruv@monkmediaone.com', hashed]
  );

  console.log('✅ Seed data inserted — Admin: dhruv@monkmediaone.com / MMO@1993#');
}

module.exports = { getDb, initDatabase };
