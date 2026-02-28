const express = require('express');
const router = express.Router();
const { getDb } = require('../database/db');
const { authenticate, adminOnly } = require('../middleware/auth');

// GET /api/roles
router.get('/', authenticate, async (req, res) => {
  try {
    const db = getDb();
    const [roles] = await db.execute(
      `SELECT r.*,
              (SELECT COUNT(*) FROM users WHERE role_id = r.id AND is_active = 1) AS member_count,
              (SELECT COUNT(*) FROM task_types WHERE role_id = r.id) AS task_type_count
       FROM roles r
       ORDER BY r.name`
    );
    res.json(roles);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/roles
router.post('/', authenticate, adminOnly, async (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Role name is required' });
  }

  try {
    const db = getDb();
    const [result] = await db.execute('INSERT INTO roles (name) VALUES (?)', [name.trim()]);
    const [rows] = await db.execute('SELECT * FROM roles WHERE id = ?', [result.insertId]);
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Role already exists' });
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/roles/:id
router.put('/:id', authenticate, adminOnly, async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });

  try {
    const db = getDb();
    await db.execute('UPDATE roles SET name = ? WHERE id = ?', [name.trim(), req.params.id]);
    const [rows] = await db.execute(
      `SELECT r.*,
              (SELECT COUNT(*) FROM users WHERE role_id = r.id AND is_active = 1) AS member_count,
              (SELECT COUNT(*) FROM task_types WHERE role_id = r.id) AS task_type_count
       FROM roles r WHERE r.id = ?`,
      [req.params.id]
    );
    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Role name already exists' });
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/roles/:id
router.delete('/:id', authenticate, adminOnly, async (req, res) => {
  try {
    const db = getDb();
    const [users] = await db.execute(
      'SELECT COUNT(*) AS count FROM users WHERE role_id = ? AND is_active = 1',
      [req.params.id]
    );
    if (Number(users[0].count) > 0) {
      return res.status(400).json({ error: `Cannot delete: ${users[0].count} team member(s) have this role` });
    }

    const [types] = await db.execute(
      'SELECT COUNT(*) AS count FROM task_types WHERE role_id = ?',
      [req.params.id]
    );
    if (Number(types[0].count) > 0) {
      return res.status(400).json({ error: `Cannot delete: ${types[0].count} task type(s) use this role` });
    }

    await db.execute('DELETE FROM roles WHERE id = ?', [req.params.id]);
    res.json({ message: 'Role deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;