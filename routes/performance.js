const express = require('express');
const router  = express.Router();
const { getDb }                   = require('../database/db');
const { authenticate, adminOnly } = require('../middleware/auth');

// GET /api/performance  — admin: performance scores for every active team member
router.get('/', authenticate, adminOnly, async (req, res) => {
  try {
    const db = getDb();

    const [users] = await db.execute(`
      SELECT u.*, r.name as role_name
      FROM users u
      LEFT JOIN roles r ON u.role_id = r.id
      WHERE u.is_active = 1 AND u.is_admin = 0
      ORDER BY u.name
    `);

    const results = await Promise.all(users.map(async user => {
      const [completedTasks] = await db.execute(
        `SELECT * FROM tasks WHERE assigned_to = ? AND status = 'completed'`,
        [user.id]
      );
      const total = completedTasks.length;

      const [[{ cnt: activeTasks }]]   = await db.execute(
        `SELECT COUNT(*) as cnt FROM tasks WHERE assigned_to = ? AND status NOT IN ('completed')`,
        [user.id]
      );
      const [[{ cnt: feedbackTasks }]] = await db.execute(
        `SELECT COUNT(*) as cnt FROM tasks WHERE assigned_to = ? AND revision_count > 0`,
        [user.id]
      );
      const [[{ total: totalSecs }]]   = await db.execute(
        `SELECT COALESCE(SUM(duration_secs), 0) as total FROM task_time_logs WHERE user_id = ?`,
        [user.id]
      );
      const timeHours = Math.round((totalSecs / 3600) * 10) / 10;

      if (total === 0) {
        return {
          id: user.id, name: user.name, role_name: user.role_name,
          score: 0, grade: 'No Data', grade_color: '#94a3b8',
          on_time_count: 0, early_count: 0, total_completed: 0,
          active_tasks: activeTasks, avg_revisions: 0, avg_tasks_per_day: 0,
          client_feedback_count: feedbackTasks, total_time_hours: timeHours,
        };
      }

      const onTimeCount = completedTasks.filter(t =>
        t.completed_at && t.completed_at.split(/[ T]/)[0] <= t.deadline
      ).length;
      const earlyCount = completedTasks.filter(t =>
        t.completed_at && t.completed_at.split(/[ T]/)[0] < t.deadline
      ).length;
      const totalRevisions = completedTasks.reduce((s, t) => s + (t.revision_count || 0), 0);
      const avgRevisions   = totalRevisions / total;

      const [[{ cnt: distinctDays }]] = await db.execute(
        `SELECT COUNT(DISTINCT completed_at::date) as cnt
         FROM tasks WHERE assigned_to = ? AND status = 'completed' AND completed_at IS NOT NULL`,
        [user.id]
      );
      const avgTasksPerDay = total / (distinctDays || 1);

      const onTimeRate      = onTimeCount / total;
      const earlyRate       = earlyCount  / total;
      const revisionPenalty = Math.min(1, avgRevisions / 3);
      const productivityRate = Math.min(1, avgTasksPerDay / 4);
      const score = Math.round(
        onTimeRate       * 40 +
        earlyRate        * 20 +
        (1 - revisionPenalty) * 25 +
        productivityRate * 15
      );

      const grade       = score >= 80 ? 'Excellent' : score >= 60 ? 'Good' : score >= 40 ? 'Average' : 'Needs Work';
      const grade_color = score >= 80 ? '#16a34a'   : score >= 60 ? '#2563eb' : score >= 40 ? '#f59e0b' : '#dc2626';

      return {
        id: user.id, name: user.name, role_name: user.role_name,
        score, grade, grade_color,
        on_time_count: onTimeCount, early_count: earlyCount,
        total_completed: total, active_tasks: activeTasks,
        avg_revisions: Math.round(avgRevisions * 10) / 10,
        avg_tasks_per_day: Math.round(avgTasksPerDay * 10) / 10,
        client_feedback_count: feedbackTasks, total_time_hours: timeHours,
      };
    }));

    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/performance/:userId — admin: detailed task breakdown for one user
router.get('/:userId', authenticate, adminOnly, async (req, res) => {
  try {
    const db  = getDb();
    const uid = parseInt(req.params.userId);

    const [[user]] = await db.execute(
      `SELECT u.*, r.name as role_name FROM users u
       LEFT JOIN roles r ON u.role_id = r.id WHERE u.id = ?`,
      [uid]
    );
    if (!user) return res.status(404).json({ error: 'User not found' });

    const [tasks] = await db.execute(
      `SELECT t.*, tt.name as task_type_name
       FROM tasks t
       LEFT JOIN task_types tt ON t.task_type_id = tt.id
       WHERE t.assigned_to = ?
       ORDER BY t.deadline DESC`,
      [uid]
    );

    const [timeLogs] = await db.execute(
      `SELECT tl.*, t.title as task_title
       FROM task_time_logs tl
       LEFT JOIN tasks t ON tl.task_id = t.id
       WHERE tl.user_id = ?
       ORDER BY tl.started_at DESC
       LIMIT 50`,
      [uid]
    );

    const [punchLogs] = await db.execute(
      `SELECT * FROM time_logs WHERE user_id = ? ORDER BY date DESC LIMIT 30`,
      [uid]
    );

    const totalTimeHours = Math.round(
      (timeLogs.reduce((s, l) => s + (l.duration_secs || 0), 0) / 3600) * 10
    ) / 10;

    res.json({
      user: { id: user.id, name: user.name, role_name: user.role_name },
      tasks, timeLogs, punchLogs, totalTimeHours,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
