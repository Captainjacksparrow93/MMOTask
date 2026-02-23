/**
 * database/db.js
 *
 * MySQL2 (promise) pool — used on Hostinger Node.js hosting.
 * Credentials come from environment variables (set in Hostinger's control panel
 * or a local .env file).
 *
 * API exposed:
 *   getDb()         — returns the mysql2 promise pool (synchronous getter)
 *   initDatabase()  — async; creates tables, seeds initial data
 *
 * Every route uses:
 *   const db = getDb();
 *   const [rows]   = await db.execute(sql, [param1, param2, ...]);
 *   const [result] = await db.execute(insertSql, [...]); // result.insertId
 */

const mysql  = require('mysql2/promise');
const bcrypt = require('bcryptjs');

let pool = null;

// ── Synchronous getter — call after initDatabase() completes ────────────────
function getDb() {
  if (!pool) throw new Error('DB not initialised — await initDatabase() first');
  return pool;
}

// ── initDatabase — async, called once at server startup ─────────────────────
async function initDatabase() {
  pool = mysql.createPool({
    host:               process.env.DB_HOST     || 'localhost',
    port:               parseInt(process.env.DB_PORT || '3306'),
    user:               process.env.DB_USER     || 'root',
    password:           process.env.DB_PASSWORD || '',
    database:           process.env.DB_NAME     || 'agency_tasks',
    waitForConnections: true,
    connectionLimit:    10,
    dateStrings:        true,   // return DATE/DATETIME as strings, not Date objects
  });

  // Test connection
  const conn = await pool.getConnection();

  // ── Create tables ──────────────────────────────────────────────────────────
  await conn.execute(`CREATE TABLE IF NOT EXISTS roles (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    name       VARCHAR(255) NOT NULL UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);

  await conn.execute(`CREATE TABLE IF NOT EXISTS users (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    name       VARCHAR(255) NOT NULL,
    email      VARCHAR(255) UNIQUE NOT NULL,
    password   VARCHAR(255) NOT NULL,
    role_id    INT,
    is_admin   TINYINT(1) DEFAULT 0,
    is_active  TINYINT(1) DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (role_id) REFERENCES roles(id)
  )`);

  await conn.execute(`CREATE TABLE IF NOT EXISTS task_types (
    id             INT AUTO_INCREMENT PRIMARY KEY,
    name           VARCHAR(255) NOT NULL,
    role_id        INT NOT NULL,
    daily_capacity INT DEFAULT 2,
    is_predefined  TINYINT(1) DEFAULT 0,
    created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (role_id) REFERENCES roles(id)
  )`);

  await conn.execute(`CREATE TABLE IF NOT EXISTS tasks (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    title           VARCHAR(500) NOT NULL,
    description     TEXT,
    client_name     VARCHAR(255),
    task_type_id    INT NOT NULL,
    urgency         VARCHAR(50) DEFAULT 'medium',
    deadline        DATE NOT NULL,
    buffer_deadline DATE NOT NULL,
    assigned_to     INT,
    status          VARCHAR(50) DEFAULT 'pending',
    progress        INT DEFAULT 0,
    revision_count  INT DEFAULT 0,
    feedback_notes  TEXT,
    completed_at    DATETIME,
    eta             VARCHAR(255),
    created_by      INT,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (task_type_id) REFERENCES task_types(id),
    FOREIGN KEY (assigned_to)  REFERENCES users(id),
    FOREIGN KEY (created_by)   REFERENCES users(id)
  )`);

  await conn.execute(`CREATE TABLE IF NOT EXISTS time_logs (
    id               INT AUTO_INCREMENT PRIMARY KEY,
    user_id          INT NOT NULL,
    date             DATE NOT NULL,
    punch_in         DATETIME,
    punch_out        DATETIME,
    duration_minutes INT DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users(id),
    UNIQUE KEY uk_user_date (user_id, date)
  )`);

  await conn.execute(`CREATE TABLE IF NOT EXISTS task_time_logs (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    task_id       INT NOT NULL,
    user_id       INT NOT NULL,
    started_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ended_at      DATETIME,
    duration_secs INT DEFAULT 0,
    FOREIGN KEY (task_id) REFERENCES tasks(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);

  // ── Add new columns to existing tasks table (idempotent) ──────────────────
  const [dbRow] = await conn.execute('SELECT DATABASE() AS db');
  const dbName  = dbRow[0].db;

  const alterColumns = [
    { table: 'tasks', col: 'progress',        def: 'INT DEFAULT 0' },
    { table: 'tasks', col: 'revision_count',  def: 'INT DEFAULT 0' },
    { table: 'tasks', col: 'feedback_notes',  def: 'TEXT' },
    { table: 'tasks', col: 'completed_at',    def: 'DATETIME' },
    { table: 'tasks', col: 'eta',             def: 'VARCHAR(255)' },
  ];

  for (const { table, col, def } of alterColumns) {
    const [exists] = await conn.execute(
      `SELECT COUNT(*) AS cnt FROM information_schema.columns
       WHERE table_schema = ? AND table_name = ? AND column_name = ?`,
      [dbName, table, col]
    );
    if (Number(exists[0].cnt) === 0) {
      try { await conn.execute(`ALTER TABLE \`${table}\` ADD COLUMN \`${col}\` ${def}`); } catch (_) {}
    }
  }

  conn.release();

  // ── Seed on first run ──────────────────────────────────────────────────────
  const [countRows] = await pool.execute('SELECT COUNT(*) AS cnt FROM roles');
  if (Number(countRows[0].cnt) === 0) await seedData();

  console.log('✅ Database ready (MySQL)');
}

// ── Seed default data ────────────────────────────────────────────────────────
async function seedData() {
  const roleNames = ['Designer', 'Video Editor', 'Content Writer', 'Social Media Manager'];
  const roleIds   = {};

  for (const name of roleNames) {
    const [res] = await pool.execute('INSERT INTO roles (name) VALUES (?)', [name]);
    roleIds[name] = res.insertId;
  }

  const taskTypes = [
    { name: 'Graphic Design',     role: 'Designer',             capacity: 2 },
    { name: 'Ad Creative',        role: 'Designer',             capacity: 2 },
    { name: 'Story Design',       role: 'Designer',             capacity: 4 },
    { name: 'Email Template',     role: 'Designer',             capacity: 2 },
    { name: 'Reels',              role: 'Video Editor',         capacity: 4 },
    { name: 'Video Editing',      role: 'Video Editor',         capacity: 2 },
    { name: 'Content Writing',    role: 'Content Writer',       capacity: 4 },
    { name: 'Blog Post',          role: 'Content Writer',       capacity: 2 },
    { name: 'Caption Writing',    role: 'Content Writer',       capacity: 6 },
    { name: 'Social Media Post',  role: 'Social Media Manager', capacity: 6 },
    { name: 'Campaign Planning',  role: 'Social Media Manager', capacity: 2 },
  ];

  for (const tt of taskTypes) {
    await pool.execute(
      'INSERT INTO task_types (name, role_id, daily_capacity, is_predefined) VALUES (?, ?, ?, 1)',
      [tt.name, roleIds[tt.role], tt.capacity]
    );
  }

  const hashed = await bcrypt.hash('Admin@1234', 10);
  await pool.execute(
    'INSERT INTO users (name, email, password, is_admin) VALUES (?, ?, ?, 1)',
    ['Admin', 'admin@agency.com', hashed]
  );

  console.log('✅ Seed data inserted — Admin: admin@agency.com / Admin@1234');
}

module.exports = { getDb, initDatabase };
