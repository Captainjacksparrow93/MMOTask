const express = require('express');
const router  = require('express').Router();
const { getDb }       = require('../database/db');
const { authenticate } = require('../middleware/auth');

function getWeekRange(dateStr) {
  const date    = new Date(dateStr + 'T12:00:00');
  const day     = date.getDay();
  const monday  = new Date(date);
  monday.setDate(date.getDate() - (day === 0 ? 6 : day - 1));
  const saturday = new Date(monday);
  saturday.setDate(monday.getDate() + 5);
  return {
    start: monday.toISOString().split('T')[0],
    end:   saturday.toISOString().split('T')[0],
  };
}

// GET /api/dashboard/stats
router.get('/stats', authenticate, async (req, res) => {
  try {
    const db    = getDb();
    const today = new Date().toISOString().split('T')[0];
    const { start: weekStart, end: weekEnd } = getWeekRange(today);
    const uid   = req.user.is_admin ? null : req.user.id;

    async function q(sql, params = []) {
      const finalSql    = uid ? sql + ' AND t.assigned_to = ?' : sql;
      const finalParams = uid ? [...params, uid] : params;
      const [[row]] = await db.execute(finalSql, finalParams);
      return row;
    }

    const [totalActive, todayTasks, weekTasks, overdueTasks, completedAll] = await Promise.all([
      q(`SELECT COUNT(*) as count FROM tasks t WHERE t.status NOT IN ('completed')`),
      q(`SELECT COUNT(*) as count FROM tasks t WHERE t.deadline = ?`, [today]),
      q(`SELECT COUNT(*) as count FROM tasks t WHERE t.deadline BETWEEN ? AND ?`, [weekStart, weekEnd]),
      q(`SELECT COUNT(*) as count FROM tasks t WHERE t.deadline < ? AND t.status NOT IN ('completed')`, [today]),
      q(`SELECT COUNT(*) as count FROM tasks t WHERE t.status = 'completed'`),
    ]);

    res.json({
      totalActive:  totalActive.count,
      todayTasks:   todayTasks.count,
      weekTasks:    weekTasks.count,
      overdueTasks: overdueTasks.count,
      completedAll: completedAll.count,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/dashboard/daily?date=YYYY-MM-DD
router.get('/daily', authenticate, async (req, res) => {
  try {
    const db   = getDb();
    const date = req.query.date || new Date().toISOString().split('T')[0];
    const uid  = req.user.is_admin ? null : req.user.id;

    let sql = `
      SELECT t.*, u.name as assignee_name, tt.name as task_type_name, r.name as role_name
      FROM tasks t
      LEFT JOIN users u       ON t.assigned_to  = u.id
      LEFT JOIN task_types tt ON t.task_type_id = tt.id
      LEFT JOIN roles r       ON tt.role_id     = r.id
      WHERE t.deadline = ?
    `;
    const params = [date];
    if (uid) { sql += ' AND t.assigned_to = ?'; params.push(uid); }
    sql += ` ORDER BY
      CASE t.urgency WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END DESC,
      u.name`;

    const [tasks] = await db.execute(sql, params);

    const map = {};
    for (const task of tasks) {
      const key = task.assigned_to || 'unassigned';
      if (!map[key]) map[key] = { assignee_id: task.assigned_to, assignee_name: task.assignee_name || 'Unassigned', role_name: task.role_name, tasks: [] };
      map[key].tasks.push(task);
    }

    res.json({ date, groups: Object.values(map), total: tasks.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/dashboard/weekly?date=YYYY-MM-DD
router.get('/weekly', authenticate, async (req, res) => {
  try {
    const db       = getDb();
    const baseDate = req.query.date || new Date().toISOString().split('T')[0];
    const { start, end } = getWeekRange(baseDate);
    const uid = req.user.is_admin ? null : req.user.id;

    let sql = `
      SELECT t.*, u.name as assignee_name, tt.name as task_type_name, r.name as role_name
      FROM tasks t
      LEFT JOIN users u       ON t.assigned_to  = u.id
      LEFT JOIN task_types tt ON t.task_type_id = tt.id
      LEFT JOIN roles r       ON tt.role_id     = r.id
      WHERE t.deadline BETWEEN ? AND ?
    `;
    const params = [start, end];
    if (uid) { sql += ' AND t.assigned_to = ?'; params.push(uid); }
    sql += ` ORDER BY t.deadline,
      CASE t.urgency WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END DESC`;

    const [tasks] = await db.execute(sql, params);

    const map = {};
    for (const task of tasks) {
      if (!map[task.deadline]) map[task.deadline] = { date: task.deadline, tasks: [] };
      map[task.deadline].tasks.push(task);
    }

    res.json({ weekStart: start, weekEnd: end, days: Object.values(map), total: tasks.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/dashboard/monthly?date=YYYY-MM-DD
router.get('/monthly', authenticate, async (req, res) => {
  try {
    const db       = getDb();
    const baseDate = req.query.date || new Date().toISOString().split('T')[0];
    const d        = new Date(baseDate + 'T12:00:00');
    const y = d.getFullYear(), m = d.getMonth() + 1;
    const start   = `${y}-${String(m).padStart(2,'0')}-01`;
    const lastDay = new Date(y, m, 0).getDate();
    const end     = `${y}-${String(m).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`;
    const uid     = req.user.is_admin ? null : req.user.id;

    let sql = `
      SELECT t.*, u.name as assignee_name, tt.name as task_type_name, r.name as role_name
      FROM tasks t
      LEFT JOIN users u       ON t.assigned_to  = u.id
      LEFT JOIN task_types tt ON t.task_type_id = tt.id
      LEFT JOIN roles r       ON tt.role_id     = r.id
      WHERE t.deadline BETWEEN ? AND ?
    `;
    const params = [start, end];
    if (uid) { sql += ' AND t.assigned_to = ?'; params.push(uid); }
    sql += ` ORDER BY t.deadline,
      CASE t.urgency WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END DESC`;

    const [tasks] = await db.execute(sql, params);
    res.json({ monthStart: start, monthEnd: end, tasks, total: tasks.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/dashboard/team-load
router.get('/team-load', authenticate, async (req, res) => {
  try {
    const db    = getDb();
    const today = new Date().toISOString().split('T')[0];

    const [members] = await db.execute(`
      SELECT u.id, u.name, r.name as role_name,
        (SELECT COUNT(*) FROM tasks WHERE assigned_to = u.id AND deadline = ? AND status != 'completed') as today_count,
        (SELECT COUNT(*) FROM tasks WHERE assigned_to = u.id AND status NOT IN ('completed'))           as active_count,
        (SELECT COUNT(*) FROM tasks WHERE assigned_to = u.id AND deadline < ? AND status NOT IN ('completed')) as overdue_count
      FROM users u
      LEFT JOIN roles r ON u.role_id = r.id
      WHERE u.is_active = 1 AND u.is_admin = 0
      ORDER BY r.name, u.name
    `, [today, today]);

    res.json(members);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
