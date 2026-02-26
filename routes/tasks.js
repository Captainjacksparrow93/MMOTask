const express = require('express');
const router  = express.Router();
const { getDb }                   = require('../database/db');
const { authenticate, adminOnly } = require('../middleware/auth');

// ── Helpers ───────────────────────────────────────────────────────────────────
function subtractWorkingDays(dateStr, days) {
  const date = new Date(dateStr + 'T12:00:00');
  let subtracted = 0;
  while (subtracted < days) {
    date.setDate(date.getDate() - 1);
    if (date.getDay() !== 0) subtracted++;
  }
  return date.toISOString().split('T')[0];
}

function nowStr() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

const TASK_SELECT = `
  SELECT t.*, u.name as assignee_name, tt.name as task_type_name, r.name as role_name
  FROM tasks t
  LEFT JOIN users u       ON t.assigned_to  = u.id
  LEFT JOIN task_types tt ON t.task_type_id = tt.id
  LEFT JOIN roles r       ON tt.role_id     = r.id
`;

// ── GET /api/tasks — all tasks with optional filters ─────────────────────────
router.get('/', authenticate, async (req, res) => {
  try {
    const db = getDb();
    let sql = TASK_SELECT + ' WHERE 1=1';
    const params = [];

    if (req.query.status)   { sql += ' AND t.status = ?';      params.push(req.query.status); }
    if (req.query.urgency)  { sql += ' AND t.urgency = ?';     params.push(req.query.urgency); }
    if (req.query.assignee) { sql += ' AND t.assigned_to = ?'; params.push(req.query.assignee); }

    if (!req.user.is_admin) { sql += ' AND t.assigned_to = ?'; params.push(req.user.id); }

    sql += ` ORDER BY
      CASE t.urgency WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END DESC,
      t.deadline ASC`;

    const [tasks] = await db.execute(sql, params);
    res.json(tasks);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/tasks/my-tasks — current user's active tasks ────────────────────
router.get('/my-tasks', authenticate, async (req, res) => {
  try {
    const db = getDb();
    const [tasks] = await db.execute(
      TASK_SELECT + `WHERE t.assigned_to = ? AND t.status NOT IN ('completed')
       ORDER BY
         CASE t.urgency WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END DESC,
         t.deadline ASC`,
      [req.user.id]
    );
    res.json(tasks);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/tasks/my-active-timer — current user's running timer ─────────────
router.get('/my-active-timer', authenticate, async (req, res) => {
  try {
    const db = getDb();
    const [[log]] = await db.execute(
      `SELECT tl.*, t.title as task_title
       FROM task_time_logs tl
       JOIN tasks t ON tl.task_id = t.id
       WHERE tl.user_id = ? AND tl.ended_at IS NULL
       ORDER BY tl.started_at DESC LIMIT 1`,
      [req.user.id]
    );
    res.json(log || null);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/tasks/assignment-preview — suggest best assignee ────────────────
router.get('/assignment-preview', authenticate, async (req, res) => {
  try {
    const db = getDb();
    const { task_type_id, deadline } = req.query;
    if (!task_type_id || !deadline) return res.status(400).json({ error: 'task_type_id and deadline are required' });

    const [[taskType]] = await db.execute('SELECT * FROM task_types WHERE id = ?', [task_type_id]);
    if (!taskType) return res.status(404).json({ error: 'Task type not found' });

    const [candidates] = await db.execute(
      `SELECT u.id, u.name,
         (SELECT COUNT(*) FROM tasks
          WHERE assigned_to = u.id AND deadline = ? AND status != 'completed') as today_count
       FROM users u
       WHERE u.role_id = ? AND u.is_active = 1 AND u.is_admin = 0
       ORDER BY today_count ASC LIMIT 5`,
      [deadline, taskType.role_id]
    );

    res.json({ task_type: taskType, candidates });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/tasks/:id — single task ─────────────────────────────────────────
router.get('/:id', authenticate, async (req, res) => {
  try {
    const db = getDb();
    const [[task]] = await db.execute(TASK_SELECT + ' WHERE t.id = ?', [req.params.id]);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    res.json(task);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/tasks — create task (admin) ────────────────────────────────────
router.post('/', authenticate, adminOnly, async (req, res) => {
  try {
    const db = getDb();
    const { title, description, client_name, task_type_id, urgency, deadline, assigned_to, eta } = req.body;

    if (!title || !task_type_id || !deadline) {
      return res.status(400).json({ error: 'title, task_type_id, and deadline are required' });
    }

    const bufferDays     = urgency === 'critical' ? 0 : urgency === 'high' ? 1 : 2;
    const bufferDeadline = subtractWorkingDays(deadline, bufferDays);

    const [result] = await db.execute(
      `INSERT INTO tasks
         (title, description, client_name, task_type_id, urgency, deadline, buffer_deadline,
          assigned_to, status, progress, eta, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?)`,
      [title, description || null, client_name || null, task_type_id,
       urgency || 'medium', deadline, bufferDeadline,
       assigned_to || null, eta || null, req.user.id]
    );

    const [[task]] = await db.execute(TASK_SELECT + ' WHERE t.id = ?', [result.insertId]);
    res.status(201).json(task);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /api/tasks/:id — update task (admin) ──────────────────────────────────
router.put('/:id', authenticate, adminOnly, async (req, res) => {
  try {
    const db = getDb();
    const [[existing]] = await db.execute('SELECT * FROM tasks WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Task not found' });

    const { title, description, client_name, task_type_id, urgency, deadline,
            assigned_to, status, eta, feedback_notes } = req.body;

    const newDeadline    = deadline  || existing.deadline;
    const newUrgency     = urgency   || existing.urgency;
    const bufferDays     = newUrgency === 'critical' ? 0 : newUrgency === 'high' ? 1 : 2;
    const bufferDeadline = subtractWorkingDays(newDeadline, bufferDays);
    const completedAt    = status === 'completed' && existing.status !== 'completed'
      ? nowStr() : existing.completed_at;

    await db.execute(
      `UPDATE tasks SET
         title = ?, description = ?, client_name = ?, task_type_id = ?,
         urgency = ?, deadline = ?, buffer_deadline = ?, assigned_to = ?,
         status = ?, eta = ?, feedback_notes = ?, completed_at = ?
       WHERE id = ?`,
      [
        title         || existing.title,
        description   !== undefined ? description   : existing.description,
        client_name   !== undefined ? client_name   : existing.client_name,
        task_type_id  || existing.task_type_id,
        newUrgency, newDeadline, bufferDeadline,
        assigned_to   !== undefined ? assigned_to   : existing.assigned_to,
        status        || existing.status,
        eta           !== undefined ? eta           : existing.eta,
        feedback_notes !== undefined ? feedback_notes : existing.feedback_notes,
        completedAt,
        req.params.id,
      ]
    );

    const [[task]] = await db.execute(TASK_SELECT + ' WHERE t.id = ?', [req.params.id]);
    res.json(task);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/tasks/:id/progress — update progress % ────────────────────────
router.patch('/:id/progress', authenticate, async (req, res) => {
  try {
    const db = getDb();

    // Auth guard: only admin or the assigned team member may update progress
    const [[existing]] = await db.execute('SELECT * FROM tasks WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Task not found' });
    if (!req.user.is_admin && Number(existing.assigned_to) !== Number(req.user.id)) {
      return res.status(403).json({ error: 'Not authorised to update this task' });
    }

    const progress = Math.min(100, Math.max(0, parseInt(req.body.progress) || 0));
    const status   = progress === 100 ? 'completed' : progress > 0 ? 'in_progress' : 'pending';
    const now      = progress === 100 ? nowStr() : null;

    await db.execute(
      `UPDATE tasks SET progress = ?, status = ?,
         completed_at = CASE WHEN ? IS NOT NULL AND completed_at IS NULL THEN ? ELSE completed_at END
       WHERE id = ?`,
      [progress, status, now, now, req.params.id]
    );

    const [[task]] = await db.execute(TASK_SELECT + ' WHERE t.id = ?', [req.params.id]);
    res.json(task);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/tasks/:id/status — update status only (admin OR assigned user) ─
router.patch('/:id/status', authenticate, async (req, res) => {
  try {
    const db = getDb();
    const allowed = ['pending', 'in_progress', 'on_hold', 'client_feedback', 'completed'];
    const { status } = req.body;
    if (!status || !allowed.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${allowed.join(', ')}` });
    }

    const [[existing]] = await db.execute('SELECT * FROM tasks WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Task not found' });

    // Only admin or the assigned team member may update status
    // Use Number() coercion to handle int vs string type differences from JWT/MySQL
    if (!req.user.is_admin && Number(existing.assigned_to) !== Number(req.user.id)) {
      return res.status(403).json({ error: 'Not authorised to update this task' });
    }

    const completedAt = status === 'completed' && existing.status !== 'completed'
      ? nowStr() : existing.completed_at;

    await db.execute(
      'UPDATE tasks SET status = ?, completed_at = ? WHERE id = ?',
      [status, completedAt, req.params.id]
    );

    const [[task]] = await db.execute(TASK_SELECT + ' WHERE t.id = ?', [req.params.id]);
    res.json(task);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/tasks/:id/timer/start ──────────────────────────────────────────
router.post('/:id/timer/start', authenticate, async (req, res) => {
  try {
    const db  = getDb();
    const now = nowStr();

    // Stop any other running timer for this user
    await db.execute(
      `UPDATE task_time_logs
       SET ended_at = ?, duration_secs = TIMESTAMPDIFF(SECOND, started_at, ?)
       WHERE user_id = ? AND ended_at IS NULL`,
      [now, now, req.user.id]
    );

    const [result] = await db.execute(
      'INSERT INTO task_time_logs (task_id, user_id, started_at) VALUES (?, ?, ?)',
      [req.params.id, req.user.id, now]
    );

    await db.execute(
      `UPDATE tasks SET status = 'in_progress' WHERE id = ? AND status = 'pending'`,
      [req.params.id]
    );

    const [[log]] = await db.execute('SELECT * FROM task_time_logs WHERE id = ?', [result.insertId]);
    res.json(log);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/tasks/:id/timer/stop ───────────────────────────────────────────
router.post('/:id/timer/stop', authenticate, async (req, res) => {
  try {
    const db  = getDb();
    const now = nowStr();

    const [[log]] = await db.execute(
      `SELECT * FROM task_time_logs
       WHERE task_id = ? AND user_id = ? AND ended_at IS NULL
       ORDER BY started_at DESC LIMIT 1`,
      [req.params.id, req.user.id]
    );
    if (!log) return res.status(400).json({ error: 'No active timer for this task' });

    await db.execute(
      `UPDATE task_time_logs
       SET ended_at = ?, duration_secs = TIMESTAMPDIFF(SECOND, started_at, ?)
       WHERE id = ?`,
      [now, now, log.id]
    );

    const [[updated]] = await db.execute('SELECT * FROM task_time_logs WHERE id = ?', [log.id]);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/tasks/:id/feedback ─────────────────────────────────────────────
router.post('/:id/feedback', authenticate, async (req, res) => {
  try {
    const db = getDb();
    await db.execute(
      `UPDATE tasks
       SET feedback_notes = ?, revision_count = revision_count + 1, status = 'revision'
       WHERE id = ?`,
      [req.body.notes || null, req.params.id]
    );

    const [[task]] = await db.execute(TASK_SELECT + ' WHERE t.id = ?', [req.params.id]);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    res.json(task);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/tasks/:id (admin) ─────────────────────────────────────────────
router.delete('/:id', authenticate, adminOnly, async (req, res) => {
  try {
    const db = getDb();
    await db.execute('DELETE FROM task_time_logs WHERE task_id = ?', [req.params.id]);
    await db.execute('DELETE FROM tasks WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
