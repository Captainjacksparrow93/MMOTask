const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { getDb } = require('../database/db');
const { authenticate, adminOnly } = require('../middleware/auth');

// GET /api/users
router.get('/', authenticate, async (req, res) => {
  try {
    const db = getDb();
    const [users] = await db.execute(
      `SELECT u.id, u.name, u.email, u.role_id, u.is_admin, u.is_active, u.created_at,
              r.name AS role_name,
              (SELECT COUNT(*) FROM tasks WHERE assigned_to = u.id AND status != 'completed') AS active_tasks,
              (SELECT COUNT(*) FROM tasks WHERE assigned_to = u.id AND status = 'completed') AS completed_tasks
       FROM users u
       LEFT JOIN roles r ON u.role_id = r.id
       WHERE u.is_active = 1 AND u.is_admin = 0
       ORDER BY r.name, u.name`
    );
    res.json(users.map(u => ({ ...u, is_admin: Boolean(u.is_admin) })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/users
router.post('/', authenticate, adminOnly, async (req, res) => {
  const { name, email, password, role_id, is_admin } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email, and password are required' });
  }

  try {
    const db = getDb();
    const hashed = await bcrypt.hash(password, 10);
    const [result] = await db.execute(
      'INSERT INTO users (name, email, password, role_id, is_admin) VALUES (?, ?, ?, ?, ?)',
      [name.trim(), email.toLowerCase().trim(), hashed, role_id || null, is_admin ? 1 : 0]
    );
    const [rows] = await db.execute(
      `SELECT u.id, u.name, u.email, u.role_id, u.is_admin, r.name AS role_name
       FROM users u LEFT JOIN roles r ON u.role_id = r.id WHERE u.id = ?`,
      [result.insertId]
    );
    res.status(201).json({ ...rows[0], is_admin: Boolean(rows[0].is_admin) });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: 'Email already exists' });
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/users/:id
router.put('/:id', authenticate, adminOnly, async (req, res) => {
  const { name, email, role_id, is_admin, password } = req.body;

  try {
    const db = getDb();
    const [existing] = await db.execute('SELECT * FROM users WHERE id = ?', [req.params.id]);
    const user = existing[0];
    if (!user) return res.status(404).json({ error: 'User not found' });

    const params = [
      name || user.name,
      email ? email.toLowerCase().trim() : user.email,
      role_id !== undefined ? role_id : user.role_id,
      is_admin !== undefined ? (is_admin ? 1 : 0) : user.is_admin,
    ];

    let query = 'UPDATE users SET name = ?, email = ?, role_id = ?, is_admin = ?';
    if (password) {
      query += ', password = ?';
      params.push(await bcrypt.hash(password, 10));
    }
    query += ' WHERE id = ?';
    params.push(req.params.id);

    await db.execute(query, params);
    const [rows] = await db.execute(
      `SELECT u.id, u.name, u.email, u.role_id, u.is_admin, r.name AS role_name
       FROM users u LEFT JOIN roles r ON u.role_id = r.id WHERE u.id = ?`,
      [req.params.id]
    );
    res.json({ ...rows[0], is_admin: Boolean(rows[0].is_admin) });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: 'Email already exists' });
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/users/:id (soft delete — deactivates user)
router.delete('/:id', authenticate, adminOnly, async (req, res) => {
  if (parseInt(req.params.id) === req.user.id) {
    return res.status(400).json({ error: 'Cannot delete your own account' });
  }

  try {
    const db = getDb();
    await db.execute('UPDATE users SET is_active = 0 WHERE id = ?', [req.params.id]);
    await db.execute(
      "UPDATE tasks SET assigned_to = NULL WHERE assigned_to = ? AND status NOT IN ('completed')",
      [req.params.id]
    );
    res.json({ message: 'Team member removed. Their pending tasks have been unassigned.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;