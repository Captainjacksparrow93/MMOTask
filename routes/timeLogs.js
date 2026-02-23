const express = require('express');
const router  = express.Router();
const { getDb }                  = require('../database/db');
const { authenticate, adminOnly } = require('../middleware/auth');

// GET /api/time-logs/today — current user's punch record for today
router.get('/today', authenticate, (req, res) => {
  const db    = getDb();
  const today = new Date().toISOString().split('T')[0];
  const log   = db.prepare('SELECT * FROM time_logs WHERE user_id = ? AND date = ?').get(req.user.id, today);
  res.json(log || { user_id: req.user.id, date: today, punch_in: null, punch_out: null, duration_minutes: 0 });
});

// POST /api/time-logs/punch-in
router.post('/punch-in', authenticate, (req, res) => {
  const db    = getDb();
  const today = new Date().toISOString().split('T')[0];
  const now   = new Date().toISOString();

  const existing = db.prepare('SELECT * FROM time_logs WHERE user_id = ? AND date = ?').get(req.user.id, today);
  if (existing) {
    if (existing.punch_in) return res.status(400).json({ error: 'Already punched in today' });
    db.prepare('UPDATE time_logs SET punch_in = ? WHERE id = ?').run(now, existing.id);
  } else {
    db.prepare('INSERT INTO time_logs (user_id, date, punch_in) VALUES (?, ?, ?)').run(req.user.id, today, now);
  }

  const log = db.prepare('SELECT * FROM time_logs WHERE user_id = ? AND date = ?').get(req.user.id, today);
  res.json(log);
});

// PATCH /api/time-logs/punch-out
router.patch('/punch-out', authenticate, (req, res) => {
  const db    = getDb();
  const today = new Date().toISOString().split('T')[0];
  const now   = new Date().toISOString();

  const log = db.prepare('SELECT * FROM time_logs WHERE user_id = ? AND date = ?').get(req.user.id, today);
  if (!log || !log.punch_in) return res.status(400).json({ error: 'Not punched in today' });
  if (log.punch_out)         return res.status(400).json({ error: 'Already punched out today' });

  const durationMins = Math.round((new Date(now) - new Date(log.punch_in)) / 60000);
  db.prepare('UPDATE time_logs SET punch_out = ?, duration_minutes = ? WHERE id = ?').run(now, durationMins, log.id);

  res.json(db.prepare('SELECT * FROM time_logs WHERE id = ?').get(log.id));
});

// GET /api/time-logs/summary — admin: all users' punch records for today
router.get('/summary', authenticate, adminOnly, (req, res) => {
  const db    = getDb();
  const today = new Date().toISOString().split('T')[0];
  const logs  = db.prepare(`
    SELECT tl.*, u.name as user_name, r.name as role_name
    FROM time_logs tl
    JOIN users u ON tl.user_id = u.id
    LEFT JOIN roles r ON u.role_id = r.id
    WHERE tl.date = ?
    ORDER BY tl.punch_in ASC
  `).all(today);
  res.json(logs);
});

// GET /api/time-logs/monthly?month=YYYY-MM — admin: all punch records for a month
router.get('/monthly', authenticate, adminOnly, (req, res) => {
  const db    = getDb();
  const month = req.query.month || new Date().toISOString().slice(0, 7); // YYYY-MM
  const [y, m] = month.split('-').map(Number);
  const start   = `${month}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const end     = `${month}-${String(lastDay).padStart(2,'0')}`;

  const logs = db.prepare(`
    SELECT tl.*, u.name as user_name, r.name as role_name
    FROM time_logs tl
    JOIN users u ON tl.user_id = u.id
    LEFT JOIN roles r ON u.role_id = r.id
    WHERE tl.date BETWEEN ? AND ?
    ORDER BY u.name ASC, tl.date ASC
  `).all(start, end);

  // Group by user
  const byUser = {};
  for (const log of logs) {
    if (!byUser[log.user_id]) {
      byUser[log.user_id] = {
        user_id:   log.user_id,
        user_name: log.user_name,
        role_name: log.role_name,
        records:   [],
        total_minutes: 0,
      };
    }
    byUser[log.user_id].records.push(log);
    byUser[log.user_id].total_minutes += log.duration_minutes || 0;
  }

  res.json({ month, monthStart: start, monthEnd: end, users: Object.values(byUser), total_records: logs.length });
});

module.exports = router;
