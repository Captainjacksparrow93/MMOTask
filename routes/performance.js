const express = require('express');
const router  = express.Router();
const { getDb }                  = require('../database/db');
const { authenticate, adminOnly } = require('../middleware/auth');

// GET /api/performance  — admin: performance scores for every active team member
router.get('/', authenticate, adminOnly, (req, res) => {
  const db = getDb();

  const users = db.prepare(`
    SELECT u.*, r.name as role_name
    FROM users u
    LEFT JOIN roles r ON u.role_id = r.id
    WHERE u.is_active = 1 AND u.is_admin = 0
    ORDER BY u.name
  `).all();

  const results = users.map(user => {
    const completedTasks = db.prepare(`
      SELECT * FROM tasks WHERE assigned_to = ? AND status = 'completed'
    `).all(user.id);

    const total = completedTasks.length;

    // Also count active tasks and client_feedback tasks
    const activeTasks        = db.prepare(`SELECT COUNT(*) as cnt FROM tasks WHERE assigned_to = ? AND status NOT IN ('completed')`).get(user.id).cnt;
    const feedbackTasks      = db.prepare(`SELECT COUNT(*) as cnt FROM tasks WHERE assigned_to = ? AND revision_count > 0`).get(user.id).cnt;
    const totalTaskTimeHours = db.prepare(`
      SELECT COALESCE(SUM(duration_secs),0) as total FROM task_time_logs WHERE user_id = ?
    `).get(user.id);
    const timeHours = Math.round((totalTaskTimeHours.total / 3600) * 10) / 10;

    if (total === 0) {
      return {
        id:                   user.id,
        name:                 user.name,
        role_name:            user.role_name,
        score:                0,
        grade:                'No Data',
        grade_color:          '#94a3b8',
        on_time_count:        0,
        early_count:          0,
        total_completed:      total,
        active_tasks:         activeTasks,
        avg_revisions:        0,
        avg_tasks_per_day:    0,
        client_feedback_count: feedbackTasks,
        total_time_hours:     timeHours,
      };
    }

    // On-time: completed_at date <= deadline
    const onTimeCount = completedTasks.filter(t =>
      t.completed_at && t.completed_at.split(/[ T]/)[0] <= t.deadline
    ).length;

    // Early: completed_at date strictly before deadline
    const earlyCount = completedTasks.filter(t =>
      t.completed_at && t.completed_at.split(/[ T]/)[0] < t.deadline
    ).length;

    // Avg revisions per completed task
    const totalRevisions = completedTasks.reduce((s, t) => s + (t.revision_count || 0), 0);
    const avgRevisions   = totalRevisions / total;

    // Avg tasks per distinct working day (days when tasks were completed)
    const distinctDaysRow = db.prepare(`
      SELECT COUNT(DISTINCT DATE(completed_at)) as cnt
      FROM tasks WHERE assigned_to = ? AND status = 'completed' AND completed_at IS NOT NULL
    `).get(user.id);
    const distinctDays   = distinctDaysRow.cnt || 1;
    const avgTasksPerDay = total / distinctDays;

    // Score formula (0–100)
    const onTimeRate       = onTimeCount / total;                // 0–1
    const earlyRate        = earlyCount  / total;                // 0–1
    const revisionPenalty  = Math.min(1, avgRevisions / 3);      // 0–1 (3+ revisions = full penalty)
    const productivityRate = Math.min(1, avgTasksPerDay / 4);    // 0–1 (4+ tasks/day = max)

    const score = Math.round(
      onTimeRate      * 40 +
      earlyRate       * 20 +
      (1 - revisionPenalty) * 25 +
      productivityRate * 15
    );

    const grade       = score >= 80 ? 'Excellent' : score >= 60 ? 'Good' : score >= 40 ? 'Average' : 'Needs Work';
    const grade_color = score >= 80 ? '#16a34a'   : score >= 60 ? '#2563eb' : score >= 40 ? '#f59e0b' : '#dc2626';

    return {
      id:                   user.id,
      name:                 user.name,
      role_name:            user.role_name,
      score,
      grade,
      grade_color,
      on_time_count:        onTimeCount,
      early_count:          earlyCount,
      total_completed:      total,
      active_tasks:         activeTasks,
      avg_revisions:        Math.round(avgRevisions * 10) / 10,
      avg_tasks_per_day:    Math.round(avgTasksPerDay * 10) / 10,
      client_feedback_count: feedbackTasks,
      total_time_hours:     timeHours,
    };
  });

  res.json(results);
});

// GET /api/performance/:userId — admin: detailed task breakdown for one user
router.get('/:userId', authenticate, adminOnly, (req, res) => {
  const db   = getDb();
  const uid  = parseInt(req.params.userId);

  const user = db.prepare(`
    SELECT u.*, r.name as role_name FROM users u
    LEFT JOIN roles r ON u.role_id = r.id WHERE u.id = ?
  `).get(uid);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const tasks = db.prepare(`
    SELECT t.*, tt.name as task_type_name
    FROM tasks t
    LEFT JOIN task_types tt ON t.task_type_id = tt.id
    WHERE t.assigned_to = ?
    ORDER BY t.deadline DESC
  `).all(uid);

  const timeLogs = db.prepare(`
    SELECT tl.*, t.title as task_title
    FROM task_time_logs tl
    LEFT JOIN tasks t ON tl.task_id = t.id
    WHERE tl.user_id = ?
    ORDER BY tl.started_at DESC
    LIMIT 50
  `).all(uid);

  const punchLogs = db.prepare(`
    SELECT * FROM time_logs WHERE user_id = ? ORDER BY date DESC LIMIT 30
  `).all(uid);

  const totalTimeHours = Math.round(
    (timeLogs.reduce((s, l) => s + (l.duration_secs || 0), 0) / 3600) * 10
  ) / 10;

  res.json({
    user: { id: user.id, name: user.name, role_name: user.role_name },
    tasks,
    timeLogs,
    punchLogs,
    totalTimeHours,
  });
});

module.exports = router;
