const express = require('express');
const router = express.Router();
const { getDb } = require('../database/db');
const { authenticate, adminOnly } = require('../middleware/auth');

// GET /api/task-types
router.get('/', authenticate, async (req, res) => {
  try {
    const db = getDb();
    const [types] = await db.execute(
      `SELECT tt.*, r.name AS role_name,
              (SELECT COUNT(*) FROM tasks WHERE task_type_id = tt.id) AS task_count
       FROM task_types tt
       LEFT JOIN roles r ON tt.role_id = r.id
       ORDER BY r.name, tt.name`
    );
    res.json(types);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/task-types
router.post('/', authenticate, adminOnly, async (req, res) => {
  const { name, role_id, daily_capacity } = req.body;
  if (!name || !role_id) {
    return res.status(400).json({ error: 'Name and role are required' });
  }

  try {
    const db = getDb();
    const [result] = await db.execute(
      'INSERT INTO task_types (name, role_id, daily_capacity, is_predefined) VALUES (?, ?, ?, 0)',
      [name.trim(), role_id, daily_capacity || 2]
    );
    const [rows] = await db.execute(
      'SELECT tt.*, r.name AS role_name FROM task_types tt LEFT JOIN roles r ON tt.role_id = r.id WHERE tt.id = ?',
      [result.insertId]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/task-types/:id
router.put('/:id', authenticate, adminOnly, async (req, res) => {
  const { name, role_id, daily_capacity } = req.body;

  try {
    const db = getDb();
    const [existing] = await db.execute('SELECT * FROM task_types WHERE id = ?', [req.params.id]);
    const type = existing[0];
    if (!type) return res.status(404).json({ error: 'Task type not found' });

    await db.execute(
      'UPDATE task_types SET name = ?, role_id = ?, daily_capacity = ? WHERE id = ?',
      [name || type.name, role_id || type.role_id, daily_capacity ?? type.daily_capacity, req.params.id]
    );
    const [rows] = await db.execute(
      'SELECT tt.*, r.name AS role_name FROM task_types tt LEFT JOIN roles r ON tt.role_id = r.id WHERE tt.id = ?',
      [req.params.id]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/task-types/:id
router.delete('/:id', authenticate, adminOnly, async (req, res) => {
  try {
    const db = getDb();
    const [usage] = await db.execute(
      'SELECT COUNT(*) AS count FROM tasks WHERE task_type_id = ?',
      [req.params.id]
    );
    if (Number(usage[0].count) > 0) {
      return res.status(400).json({ error: `Cannot delete: ${usage[0].count} task(s) use this type` });
    }
    await db.execute('DELETE FROM task_types WHERE id = ?', [req.params.id]);
    res.json({ message: 'Task type deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;