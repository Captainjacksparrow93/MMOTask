/* ═══════════════════════════════════════════════════════════════
   TaskFlow — Agency Task Manager  |  app.js
   ═══════════════════════════════════════════════════════════════ */

// ── Constants ──────────────────────────────────────────────────
const URGENCY_LABEL  = { critical:'Critical', high:'High', medium:'Medium', low:'Low' };
const URGENCY_ORDER  = { critical:4, high:3, medium:2, low:1 };
const STATUS_LABEL   = { pending:'Pending', in_progress:'In Progress', completed:'Completed', on_hold:'On Hold', client_feedback:'Client Feedback' };
const DAY_NAMES      = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const MONTH_NAMES    = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const AVATAR_COLORS  = ['#6366f1','#8b5cf6','#ec4899','#14b8a6','#f59e0b','#ef4444','#22c55e','#3b82f6'];

// ── State ──────────────────────────────────────────────────────
const state = {
  user:          null,
  token:         localStorage.getItem('tf_token') || null,
  currentView:   'dashboard',
  taskView:      'daily',
  taskDate:      todayStr(),
  roles:         [],
  taskTypes:     [],
  users:         [],
  // Timers
  punchInterval:           null,   // setInterval for punch clock display
  timerInterval:           null,   // setInterval for active task timer display
  activeTimer:             null,   // { id, task_id, started_at } of running task_time_log
  dashboardRefreshInterval: null,  // setInterval for admin live refresh
  punchLog:                null,   // today's punch log for team members
  presetFilter:            null,   // { status: 'completed' } | { overdue: true } | null
};

// ── Utilities ──────────────────────────────────────────────────
function todayStr() { return new Date().toISOString().split('T')[0]; }

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr + 'T12:00:00');
  return `${DAY_NAMES[d.getDay()].slice(0,3)}, ${d.getDate()} ${MONTH_NAMES[d.getMonth()].slice(0,3)} ${d.getFullYear()}`;
}
function formatDateShort(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr + 'T12:00:00');
  return `${d.getDate()} ${MONTH_NAMES[d.getMonth()].slice(0,3)}`;
}
function getMonthLabel(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  return `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
}
function getWeekLabel(start, end) {
  return `${formatDateShort(start)} – ${formatDateShort(end)}`;
}
function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().split('T')[0];
}
function getWeekStart(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  const day = d.getDay();
  const mon = new Date(d);
  mon.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  return mon.toISOString().split('T')[0];
}
function isToday(dateStr) { return dateStr === todayStr(); }
function isPast(dateStr)  { return dateStr < todayStr(); }

function getInitials(name) {
  if (!name) return '?';
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}
function getAvatarColor(id) {
  return AVATAR_COLORS[(id || 0) % AVATAR_COLORS.length];
}

function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function formatSeconds(s) {
  s = Math.max(0, Math.floor(s));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
}

function formatMinutes(m) {
  const h = Math.floor(m / 60);
  const min = m % 60;
  return h > 0 ? `${h}h ${min}m` : `${min}m`;
}

function formatTime12(isoStr) {
  if (!isoStr) return '—';
  const d = new Date(isoStr);
  let h = d.getHours(), m = d.getMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${String(m).padStart(2,'0')} ${ampm}`;
}

// ── API ────────────────────────────────────────────────────────
const api = {
  _headers() {
    return { 'Content-Type':'application/json', ...(state.token ? { Authorization:`Bearer ${state.token}` } : {}) };
  },
  async _fetch(method, path, body) {
    const opts = { method, headers: this._headers() };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch('/api' + path, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 503) throw new Error('Server is starting up — please wait a moment and try again.');
      throw new Error(data.error || `HTTP ${res.status}`);
    }
    return data;
  },
  get(path)         { return this._fetch('GET',    path); },
  post(path, body)  { return this._fetch('POST',   path, body); },
  put(path, body)   { return this._fetch('PUT',    path, body); },
  patch(path, body) { return this._fetch('PATCH',  path, body); },
  del(path)         { return this._fetch('DELETE', path); },
};

// ── Toast ──────────────────────────────────────────────────────
function showToast(message, type = 'success') {
  const icons = { success:'fa-circle-check', error:'fa-circle-xmark', warning:'fa-triangle-exclamation' };
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.innerHTML = `<i class="fas ${icons[type] || icons.success}"></i><span>${escHtml(message)}</span>`;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => { el.classList.add('toast-fade'); setTimeout(() => el.remove(), 300); }, 3200);
}

// ── Modal ──────────────────────────────────────────────────────
let _modalCallback = null;

function showModal(title, bodyHTML, onSubmit) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = bodyHTML;
  document.getElementById('modal-overlay').style.display = 'flex';
  _modalCallback = onSubmit || null;
  if (onSubmit) {
    const form = document.getElementById('modal-body').querySelector('form');
    if (form) {
      form.onsubmit = async (e) => {
        e.preventDefault();
        const submitBtn = form.querySelector('[type=submit]');
        if (submitBtn) { submitBtn.disabled = true; submitBtn.innerHTML = '<i class="fas fa-spinner btn-loading"></i> Saving…'; }
        try { await onSubmit(new FormData(form)); closeModal(); }
        catch (err) {
          showToast(err.message, 'error');
          if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Save'; }
        }
      };
    }
  }
}
function closeModal() {
  document.getElementById('modal-overlay').style.display = 'none';
  document.getElementById('modal-body').innerHTML = '';
  _modalCallback = null;
}
function closeModalOnOverlay(e) {
  if (e.target === document.getElementById('modal-overlay')) closeModal();
}

// ── Confirm Dialog ─────────────────────────────────────────────
function showConfirm(message, onConfirm, title = 'Are you sure?') {
  document.getElementById('confirm-title').textContent   = title;
  document.getElementById('confirm-message').textContent = message;
  document.getElementById('confirm-overlay').style.display = 'flex';
  document.getElementById('confirm-ok-btn').onclick = async () => {
    closeConfirm();
    await onConfirm();
  };
}
function closeConfirm() {
  document.getElementById('confirm-overlay').style.display = 'none';
}

// ── Badge Helpers ──────────────────────────────────────────────
function urgencyBadge(u) {
  return `<span class="badge badge-${u}"><i class="fas fa-circle" style="font-size:7px"></i>${URGENCY_LABEL[u]||u}</span>`;
}
function statusBadge(s) {
  return `<span class="badge badge-${s}">${STATUS_LABEL[s]||s}</span>`;
}

// ── Navigation ─────────────────────────────────────────────────
function navigate(view) {
  state.currentView = view;
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.view === view);
  });
  renderView();
}

async function renderView() {
  // Stop live-refresh polling when leaving dashboard
  if (state.currentView !== 'dashboard') {
    clearInterval(state.dashboardRefreshInterval);
    state.dashboardRefreshInterval = null;
  }
  const vc = document.getElementById('view-container');
  vc.innerHTML = `<div class="spinner-wrap"><div class="spinner"></div></div>`;
  try {
    switch (state.currentView) {
      case 'dashboard': await renderDashboard(); break;
      case 'tasks':     await renderTasks();     break;
      case 'team':      await renderTeam();      break;
      case 'settings':  await renderSettings();  break;
    }
  } catch (err) {
    vc.innerHTML = `<div class="alert alert-error"><i class="fas fa-circle-xmark"></i> ${escHtml(err.message)}</div>`;
  }
}

// ═══════════════════════════════════════════════════════════════
// DASHBOARD VIEW
// ═══════════════════════════════════════════════════════════════
async function renderDashboard() {
  // Clear any old timer / polling intervals before re-rendering
  clearInterval(state.punchInterval);
  clearInterval(state.timerInterval);
  clearInterval(state.dashboardRefreshInterval);
  state.punchInterval           = null;
  state.timerInterval           = null;
  state.dashboardRefreshInterval = null;

  const isAdmin = state.user.is_admin;

  const [stats, daily, teamLoad, punchLog, myTasks, activeTimer, perfData, timesheetData] = await Promise.all([
    api.get('/dashboard/stats'),
    api.get(`/dashboard/daily?date=${todayStr()}`),
    isAdmin ? api.get('/dashboard/team-load')      : Promise.resolve([]),
    !isAdmin ? api.get('/time-logs/today')         : Promise.resolve(null),
    !isAdmin ? api.get('/tasks/my-tasks')          : Promise.resolve([]),
    !isAdmin ? api.get('/tasks/my-active-timer')   : Promise.resolve(null),
    isAdmin  ? api.get('/performance')             : Promise.resolve([]),
    isAdmin  ? api.get('/time-logs/summary').catch(() => []) : Promise.resolve([]),
  ]);

  // Save active timer and punch log in state
  state.activeTimer = activeTimer || null;
  state.punchLog    = punchLog    || null;

  const today = todayStr();
  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  })();

  let html = `
    <div class="page-header">
      <div class="page-header-left">
        <h2>${greeting}, ${escHtml(state.user.name.split(' ')[0])} 👋</h2>
        <p>${formatDate(today)} — Here's what's on the plate today</p>
      </div>
      ${isAdmin ? `<div class="page-header-actions"><button class="btn btn-primary" onclick="showAddTaskModal()"><i class="fas fa-plus"></i> Add Task</button></div>` : ''}
    </div>`;

  // ── Punch widget (team members only) ────────────────────────
  if (!isAdmin) {
    html += renderPunchWidget(punchLog);
  }

  html += `
    <div class="stats-grid">
      <div class="stat-card clickable" title="View active tasks" onclick="filterByCard('active')">
        <div class="stat-icon indigo"><i class="fas fa-list-check"></i></div>
        <div class="stat-body"><div class="stat-value">${stats.totalActive}</div><div class="stat-label">Active Tasks</div></div>
      </div>
      <div class="stat-card clickable" title="View tasks due today" onclick="filterByCard('today')">
        <div class="stat-icon blue"><i class="fas fa-calendar-day"></i></div>
        <div class="stat-body"><div class="stat-value">${stats.todayTasks}</div><div class="stat-label">Due Today</div></div>
      </div>
      <div class="stat-card clickable" title="View tasks due this week" onclick="filterByCard('week')">
        <div class="stat-icon amber"><i class="fas fa-calendar-week"></i></div>
        <div class="stat-body"><div class="stat-value">${stats.weekTasks}</div><div class="stat-label">This Week</div></div>
      </div>
      <div class="stat-card clickable" title="View overdue tasks" onclick="filterByCard('overdue')">
        <div class="stat-icon red"><i class="fas fa-circle-exclamation"></i></div>
        <div class="stat-body"><div class="stat-value">${stats.overdueTasks}</div><div class="stat-label">Overdue</div></div>
      </div>
      <div class="stat-card clickable" title="View completed tasks" onclick="filterByCard('completed')">
        <div class="stat-icon green"><i class="fas fa-circle-check"></i></div>
        <div class="stat-body"><div class="stat-value">${stats.completedAll}</div><div class="stat-label">Completed All Time</div></div>
      </div>
    </div>`;

  // ── My Tasks list (team members only) ───────────────────────
  if (!isAdmin) {
    html += `<div class="card my-tasks-section" style="margin-bottom:20px">
      <div class="card-header">
        <h3><i class="fas fa-clipboard-list" style="color:var(--primary);margin-right:6px"></i> My Active Tasks</h3>
        <span class="badge badge-medium">${myTasks.length}</span>
      </div>
      <div class="card-body">`;
    if (myTasks.length === 0) {
      html += `<div class="empty-state" style="padding:24px"><div class="empty-icon"><i class="fas fa-party-horn"></i></div><h3>All clear!</h3><p>No active tasks assigned to you.</p></div>`;
    } else {
      for (const t of myTasks) {
        html += renderTaskCard(t);
      }
    }
    html += `</div></div>`;
  }

  // ── Today's tasks grouped by person (admin: all; team: own) ─
  if (isAdmin) {
    html += `<div class="card" style="margin-bottom:20px">
      <div class="card-header">
        <h3><i class="fas fa-sun" style="color:#f59e0b;margin-right:6px"></i> Today's Tasks</h3>
        <span class="badge badge-medium">${daily.total} task${daily.total !== 1 ? 's' : ''}</span>
      </div>
      <div class="card-body">`;
    if (!daily.groups || daily.groups.length === 0) {
      html += `<div class="empty-state"><div class="empty-icon"><i class="fas fa-mug-hot"></i></div><h3>Nothing due today!</h3><p>Take a breather — no tasks are scheduled for today.</p></div>`;
    } else {
      for (const group of daily.groups) {
        html += `
          <div class="daily-group">
            <div class="daily-group-header">
              <div class="daily-group-avatar" style="background:${getAvatarColor(group.assignee_id)}">${getInitials(group.assignee_name)}</div>
              <div class="daily-group-info">
                <h4>${escHtml(group.assignee_name)}</h4>
                <span>${escHtml(group.role_name || '')}</span>
              </div>
              <span class="daily-group-count">${group.tasks.length} task${group.tasks.length !== 1 ? 's' : ''}</span>
            </div>
            <div class="task-list">`;
        for (const t of group.tasks) html += renderTaskCard(t);
        html += `</div></div>`;
      }
    }
    html += `</div></div>`;
  }

  // ── Team load (admin only) ───────────────────────────────────
  if (isAdmin && teamLoad.length > 0) {
    html += `<div class="card" style="margin-bottom:20px"><div class="card-header"><h3><i class="fas fa-users" style="color:var(--primary);margin-right:6px"></i> Team Load Today</h3></div><div class="card-body">
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:14px">`;
    for (const m of teamLoad) {
      const pct = Math.min(100, Math.round((m.today_count / 6) * 100));
      const fillClass = pct >= 90 ? 'danger' : pct >= 70 ? 'warning' : '';
      html += `
        <div style="background:var(--bg);border-radius:var(--radius);padding:12px">
          <div class="flex-center" style="margin-bottom:8px">
            <div class="user-avatar" style="background:${getAvatarColor(m.id)}">${getInitials(m.name)}</div>
            <div>
              <div style="font-weight:600;font-size:13px">${escHtml(m.name)}</div>
              <div style="font-size:11px;color:var(--text-muted)">${escHtml(m.role_name||'')}</div>
            </div>
          </div>
          <div class="flex-center" style="font-size:12px;margin-bottom:6px">
            <span style="color:var(--info)"><b>${m.today_count}</b> today</span> &nbsp;·&nbsp;
            <span style="color:var(--text-muted)"><b>${m.active_count}</b> active</span>
            ${m.overdue_count > 0 ? `&nbsp;·&nbsp;<span style="color:var(--error)"><b>${m.overdue_count}</b> overdue</span>` : ''}
          </div>
          <div class="load-bar"><div class="load-bar-fill ${fillClass}" style="width:${pct}%"></div></div>
        </div>`;
    }
    html += `</div></div></div>`;
  }

  // ── Timesheet section (admin only) ────────────────────────
  if (isAdmin) {
    html += renderTimesheetSection(timesheetData);
  }

  // ── Performance section (admin only) ───────────────────────
  if (isAdmin && perfData.length > 0) {
    html += renderPerformanceSection(perfData);
  }

  document.getElementById('view-container').innerHTML = html;

  // Start punch clock ticking (team members)
  if (!isAdmin && punchLog && punchLog.punch_in && !punchLog.punch_out) {
    startPunchClock(punchLog.punch_in);
  }
  // Start task timer ticking if one is running
  if (!isAdmin && state.activeTimer) {
    startTimerTick();
  }

  // Live refresh every 30 seconds (admin only)
  if (isAdmin) {
    state.dashboardRefreshInterval = setInterval(() => {
      if (state.currentView !== 'dashboard') {
        clearInterval(state.dashboardRefreshInterval);
        state.dashboardRefreshInterval = null;
        return;
      }
      renderDashboard();
    }, 30000);
  }
}

// ── Punch Widget ─────────────────────────────────────────────────
function renderPunchWidget(log) {
  const punchedIn  = log && log.punch_in && !log.punch_out;
  const punchedOut = log && log.punch_in && log.punch_out;

  let clockHtml, statusHtml, btnHtml;
  if (punchedIn) {
    clockHtml  = `<div class="punch-clock" id="punch-clock">${formatSeconds(Math.floor((Date.now() - new Date(log.punch_in)) / 1000))}</div>`;
    statusHtml = `<div class="punch-status"><div class="punch-status-label">Punched in at</div><div class="punch-status-time">${formatTime12(log.punch_in)}</div></div>`;
    btnHtml    = `<button class="btn punch-btn-out" onclick="doPunchOut()"><i class="fas fa-stop-circle"></i> Punch Out</button>`;
  } else if (punchedOut) {
    const dur = log.duration_minutes || 0;
    clockHtml  = `<div class="punch-clock" style="color:var(--success)">${formatMinutes(dur)}</div>`;
    statusHtml = `<div class="punch-status"><div class="punch-status-label">Work session complete</div><div class="punch-status-time">${formatTime12(log.punch_in)} – ${formatTime12(log.punch_out)}</div></div>`;
    btnHtml    = `<button class="btn btn-outline" disabled><i class="fas fa-check-circle"></i> Done for today</button>`;
  } else {
    clockHtml  = `<div class="punch-clock" style="color:var(--text-muted)">--:--:--</div>`;
    statusHtml = `<div class="punch-status"><div class="punch-status-label">Not punched in</div><div class="punch-status-time">Start your work day</div></div>`;
    btnHtml    = `<button class="btn punch-btn-in" onclick="doPunchIn()"><i class="fas fa-play-circle"></i> Punch In</button>`;
  }

  return `<div class="punch-widget">
    ${clockHtml}
    ${statusHtml}
    ${btnHtml}
  </div>`;
}

function startPunchClock(punchInISO) {
  clearInterval(state.punchInterval);
  state.punchInterval = setInterval(() => {
    const el = document.getElementById('punch-clock');
    if (!el) { clearInterval(state.punchInterval); return; }
    el.textContent = formatSeconds(Math.floor((Date.now() - new Date(punchInISO)) / 1000));
  }, 1000);
}

async function doPunchIn() {
  try {
    const log = await api.post('/time-logs/punch-in', {});
    showToast('Punched in — have a great day!');
    renderDashboard();
  } catch(e) { showToast(e.message, 'error'); }
}

async function doPunchOut() {
  try {
    const log = await api.patch('/time-logs/punch-out', {});
    clearInterval(state.punchInterval);
    showToast(`Punched out — ${formatMinutes(log.duration_minutes)} logged today`);
    renderDashboard();
  } catch(e) { showToast(e.message, 'error'); }
}

// ── Stat Card Quick Filters ───────────────────────────────────────
function filterByCard(cardType) {
  state.presetFilter = null;
  if (cardType === 'today') {
    state.taskView = 'daily';
    state.taskDate = todayStr();
    navigate('tasks');
  } else if (cardType === 'week') {
    state.taskView = 'weekly';
    state.taskDate = getWeekStart(todayStr());
    navigate('tasks');
  } else if (cardType === 'active') {
    state.taskView = 'all';
    state.presetFilter = { active: true };
    navigate('tasks');
  } else if (cardType === 'overdue') {
    state.taskView = 'all';
    state.presetFilter = { overdue: true };
    navigate('tasks');
  } else if (cardType === 'completed') {
    state.taskView = 'all';
    state.presetFilter = { status: 'completed' };
    navigate('tasks');
  }
}

// ── Task Timer ───────────────────────────────────────────────────
function startTimerTick() {
  clearInterval(state.timerInterval);
  state.timerInterval = setInterval(() => {
    if (!state.activeTimer) { clearInterval(state.timerInterval); return; }
    const el = document.querySelector(`.timer-display[data-task-id="${state.activeTimer.task_id}"]`);
    if (!el) return;
    const secs = Math.floor((Date.now() - new Date(state.activeTimer.started_at)) / 1000);
    el.textContent = formatSeconds(secs);
  }, 1000);
}

async function startTaskTimer(taskId) {
  try {
    const log = await api.post(`/tasks/${taskId}/timer/start`, {});
    state.activeTimer = log;
    showToast('Timer started');
    // Re-render just the dashboard or current view
    renderView();
  } catch(e) { showToast(e.message, 'error'); }
}

async function stopTaskTimer(taskId) {
  try {
    await api.post(`/tasks/${taskId}/timer/stop`, {});
    state.activeTimer = null;
    clearInterval(state.timerInterval);
    showToast('Timer stopped — time logged');
    renderView();
  } catch(e) { showToast(e.message, 'error'); }
}

// ── Task Progress ────────────────────────────────────────────────
let _progressTimers = {};
async function saveTaskProgress(taskId, value) {
  clearTimeout(_progressTimers[taskId]);
  _progressTimers[taskId] = setTimeout(async () => {
    try {
      await api.patch(`/tasks/${taskId}/progress`, { progress: parseInt(value) });
      if (parseInt(value) === 100) {
        showToast('Task completed! 🎉');
        renderView();
      }
    } catch(e) { showToast(e.message, 'error'); }
  }, 600);
}

// ── Feedback Modal ───────────────────────────────────────────────
function showFeedbackModal(taskId, title) {
  const html = `
    <form>
      <p style="color:var(--text-muted);font-size:13px;margin-bottom:16px">
        Mark "<strong>${escHtml(title)}</strong>" as requiring client revisions. This increments the revision counter and sets status to <em>Client Feedback</em>.
      </p>
      <div class="form-group">
        <label>Feedback Notes <span class="form-hint" style="display:inline">(optional)</span></label>
        <textarea name="notes" rows="3" placeholder="Describe what the client wants changed…"></textarea>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary" style="background:#f59e0b;color:#fff"><i class="fas fa-comment-dots"></i> Submit Feedback</button>
      </div>
    </form>`;
  showModal('Client Feedback', html, async (fd) => {
    await api.post(`/tasks/${taskId}/feedback`, { notes: fd.get('notes') || null });
    showToast('Marked as Client Feedback — revision count updated');
    renderView();
  });
}

// ── Performance Section ──────────────────────────────────────────
function renderPerformanceSection(data) {
  let html = `<div class="card"><div class="card-header">
    <h3><i class="fas fa-chart-line" style="color:var(--primary);margin-right:6px"></i> Team Performance</h3>
    <span class="text-muted text-sm">Click a card for detailed report</span>
  </div><div class="card-body">
    <div class="perf-grid">`;

  for (const p of data) {
    const noData = p.grade === 'No Data';
    const barPct = p.score;

    html += `
      <div class="perf-card clickable" title="Click for detailed report" onclick="showPerfDetailModal(${p.id})">
        <div class="perf-card-top">
          <div class="perf-score-circle" style="background:${p.grade_color}">${noData ? '—' : p.score}</div>
          <div class="perf-info">
            <div class="perf-name">${escHtml(p.name)}</div>
            <div class="perf-role">${escHtml(p.role_name||'')}</div>
            <span class="perf-grade" style="background:${p.grade_color}22;color:${p.grade_color}">${p.grade}</span>
          </div>
        </div>
        ${!noData ? `
        <div class="perf-stats">
          <div class="perf-stat-item">
            <div class="perf-stat-val" style="color:var(--success)">${p.on_time_count}</div>
            <div class="perf-stat-lbl">On Time</div>
          </div>
          <div class="perf-stat-item">
            <div class="perf-stat-val" style="color:var(--info)">${p.total_completed}</div>
            <div class="perf-stat-lbl">Completed</div>
          </div>
          <div class="perf-stat-item">
            <div class="perf-stat-val" style="color:${p.avg_revisions > 1 ? 'var(--error)' : 'var(--text-muted)'}">${p.avg_revisions}</div>
            <div class="perf-stat-lbl">Avg Revisions</div>
          </div>
          <div class="perf-stat-item">
            <div class="perf-stat-val" style="color:var(--primary)">${p.avg_tasks_per_day}</div>
            <div class="perf-stat-lbl">Tasks/Day</div>
          </div>
        </div>
        <div class="perf-bar-row">
          <div class="perf-bar-label"><span>Performance Score</span><span>${p.score}/100</span></div>
          <div class="perf-bar"><div class="perf-bar-fill" style="width:${barPct}%;background:${p.grade_color}"></div></div>
        </div>
        ${p.client_feedback_count > 0 ? `<div style="margin-top:8px;font-size:11px;color:#92400e"><i class="fas fa-rotate"></i> ${p.client_feedback_count} task${p.client_feedback_count!==1?'s':''} with client revisions</div>` : ''}
        ` : `<p class="text-muted text-sm" style="text-align:center;padding:12px 0">No completed tasks yet</p>`}
        <div style="margin-top:8px;font-size:11px;color:var(--primary);text-align:center"><i class="fas fa-chart-bar"></i> View detailed report</div>
      </div>`;
  }

  html += `</div></div></div>`;
  return html;
}

async function showPerfDetailModal(userId) {
  try {
    const data = await api.get(`/performance/${userId}`);
    const { user, tasks, timeLogs, punchLogs, totalTimeHours } = data;

    const completed = tasks.filter(t => t.status === 'completed');
    const active    = tasks.filter(t => t.status !== 'completed');
    const overdue   = active.filter(t => t.deadline < todayStr());

    let html = `
      <div style="font-size:13px">
        <!-- Summary row -->
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px">
          <div style="text-align:center;background:var(--bg);padding:12px;border-radius:var(--radius)">
            <div style="font-size:22px;font-weight:700;color:var(--info)">${tasks.length}</div>
            <div style="font-size:11px;color:var(--text-muted);margin-top:2px">Total Tasks</div>
          </div>
          <div style="text-align:center;background:var(--bg);padding:12px;border-radius:var(--radius)">
            <div style="font-size:22px;font-weight:700;color:var(--success)">${completed.length}</div>
            <div style="font-size:11px;color:var(--text-muted);margin-top:2px">Completed</div>
          </div>
          <div style="text-align:center;background:var(--bg);padding:12px;border-radius:var(--radius)">
            <div style="font-size:22px;font-weight:700;color:var(--error)">${overdue.length}</div>
            <div style="font-size:11px;color:var(--text-muted);margin-top:2px">Overdue</div>
          </div>
          <div style="text-align:center;background:var(--bg);padding:12px;border-radius:var(--radius)">
            <div style="font-size:22px;font-weight:700;color:var(--primary)">${totalTimeHours}h</div>
            <div style="font-size:11px;color:var(--text-muted);margin-top:2px">Time Logged</div>
          </div>
        </div>

        <!-- Task history -->
        <div style="font-weight:700;margin-bottom:8px;font-size:13px">Task History</div>
        <div class="perf-detail-tasks" style="max-height:280px;overflow-y:auto;border:1px solid var(--border);border-radius:var(--radius)">`;

    if (tasks.length === 0) {
      html += `<p class="text-muted text-sm" style="text-align:center;padding:16px">No tasks assigned yet.</p>`;
    } else {
      for (const t of tasks) {
        const isOverdue = t.deadline < todayStr() && t.status !== 'completed';
        html += `<div class="perf-detail-task-row">
          <div class="perf-detail-task-title">${escHtml(t.title)}</div>
          <div style="display:flex;gap:6px;align-items:center">
            ${statusBadge(t.status)}
            <span class="perf-detail-task-date ${isOverdue?'text-danger':''}">${formatDateShort(t.deadline)}${isOverdue?' ⚠️':''}</span>
          </div>
          ${t.revision_count > 0 ? `<span class="revision-badge"><i class="fas fa-rotate"></i>${t.revision_count}</span>` : ''}
        </div>`;
      }
    }

    html += `</div>

        <!-- Recent punch logs -->
        <div style="font-weight:700;margin:16px 0 8px;font-size:13px">Recent Punch Records (last 30 days)</div>`;

    if (punchLogs.length === 0) {
      html += `<p class="text-muted text-sm">No punch records yet.</p>`;
    } else {
      html += `<div class="timesheet-table-wrap"><table class="timesheet-table" style="font-size:12px">
        <thead><tr><th>Date</th><th>Punch In</th><th>Punch Out</th><th>Duration</th></tr></thead><tbody>`;
      for (const p of punchLogs) {
        html += `<tr>
          <td>${formatDate(p.date)}</td>
          <td>${formatTime12(p.punch_in)}</td>
          <td>${p.punch_out ? formatTime12(p.punch_out) : '—'}</td>
          <td>${p.duration_minutes ? formatMinutes(p.duration_minutes) : '—'}</td>
        </tr>`;
      }
      html += `</tbody></table></div>`;
    }

    html += `
        <div style="text-align:right;margin-top:16px">
          <button class="btn btn-outline" onclick="closeModal()">Close</button>
        </div>
      </div>`;

    showModal(`${escHtml(user.name)} — Performance Detail`, html, null);
  } catch(e) {
    showToast(e.message, 'error');
  }
}

// ── Timesheet Section ────────────────────────────────────────────
function renderTimesheetSection(todayLogs) {
  const today = todayStr();
  const currentMonth = today.slice(0, 7); // YYYY-MM
  let html = `<div class="card" style="margin-bottom:20px" id="timesheet-card">
    <div class="card-header">
      <h3><i class="fas fa-clock" style="color:var(--primary);margin-right:6px"></i> Timesheet</h3>
      <div style="display:flex;gap:8px;align-items:center">
        <button class="btn btn-outline btn-sm ts-tab-btn" id="ts-today-btn" onclick="switchTimesheetView('today')" style="font-weight:700;border-color:var(--primary);color:var(--primary)">Today</button>
        <button class="btn btn-outline btn-sm ts-tab-btn" id="ts-month-btn" onclick="switchTimesheetView('month')">Monthly View</button>
      </div>
    </div>
    <div class="card-body" id="timesheet-body">`;

  html += renderTimesheetTable(todayLogs, today);
  html += `</div></div>`;
  return html;
}

function renderTimesheetTable(logs, dateLabel) {
  let html = `<p style="font-size:12px;color:var(--text-muted);margin-bottom:10px">${formatDate(dateLabel)}</p>`;
  if (!logs || logs.length === 0) {
    html += `<p class="text-muted text-sm" style="text-align:center;padding:12px 0"><i class="fas fa-user-clock"></i> No punch records found.</p>`;
    return html;
  }
  html += `<div class="timesheet-table-wrap"><table class="timesheet-table">
    <thead><tr>
      <th>Member</th>
      <th>Role</th>
      <th>Punch In</th>
      <th>Punch Out</th>
      <th>Duration</th>
      <th>Status</th>
    </tr></thead><tbody>`;

  for (const log of logs) {
    const punchedIn  = log.punch_in && !log.punch_out;
    const punchedOut = log.punch_in && log.punch_out;
    const dur        = log.duration_minutes || 0;
    const statusHtml = punchedIn
      ? `<span class="badge" style="background:#dcfce7;color:#16a34a"><i class="fas fa-circle" style="font-size:7px;margin-right:4px"></i>Active</span>`
      : punchedOut
        ? `<span class="badge badge-medium">Done — ${formatMinutes(dur)}</span>`
        : `<span class="badge" style="background:#f1f5f9;color:#64748b">Not in</span>`;

    html += `<tr>
      <td>
        <div class="flex-center" style="gap:8px">
          <div class="user-avatar" style="width:28px;height:28px;font-size:11px;background:${getAvatarColor(log.user_id)}">${getInitials(log.user_name)}</div>
          <span style="font-weight:500;font-size:13px">${escHtml(log.user_name)}</span>
        </div>
      </td>
      <td><span class="text-muted text-sm">${escHtml(log.role_name||'—')}</span></td>
      <td><span class="text-sm">${formatTime12(log.punch_in)}</span></td>
      <td><span class="text-sm">${punchedOut ? formatTime12(log.punch_out) : '—'}</span></td>
      <td><span class="text-sm">${punchedOut ? formatMinutes(dur) : (punchedIn ? '<span class="text-success">In progress</span>' : '—')}</span></td>
      <td>${statusHtml}</td>
    </tr>`;
  }
  html += `</tbody></table></div>`;
  return html;
}

async function switchTimesheetView(view) {
  // Toggle button styles
  const todayBtn = document.getElementById('ts-today-btn');
  const monthBtn = document.getElementById('ts-month-btn');
  const body     = document.getElementById('timesheet-body');
  if (!body) return;

  if (view === 'today') {
    if (todayBtn) { todayBtn.style.fontWeight='700'; todayBtn.style.borderColor='var(--primary)'; todayBtn.style.color='var(--primary)'; }
    if (monthBtn) { monthBtn.style.fontWeight=''; monthBtn.style.borderColor=''; monthBtn.style.color=''; }
    body.innerHTML = '<div class="spinner-wrap"><div class="spinner"></div></div>';
    const logs = await api.get('/time-logs/summary').catch(() => []);
    body.innerHTML = renderTimesheetTable(logs, todayStr());
  } else {
    if (monthBtn) { monthBtn.style.fontWeight='700'; monthBtn.style.borderColor='var(--primary)'; monthBtn.style.color='var(--primary)'; }
    if (todayBtn) { todayBtn.style.fontWeight=''; todayBtn.style.borderColor=''; todayBtn.style.color=''; }
    const currentMonth = todayStr().slice(0, 7);
    body.innerHTML = `<div style="margin-bottom:12px;display:flex;align-items:center;gap:8px">
      <label style="font-size:13px;font-weight:600">Month:</label>
      <input type="month" id="ts-month-picker" value="${currentMonth}" style="padding:6px 10px;border:1px solid var(--border);border-radius:var(--radius);font-size:13px"
        onchange="loadMonthlyTimesheet(this.value)">
    </div>
    <div id="ts-monthly-content"><div class="spinner-wrap"><div class="spinner"></div></div></div>`;
    await loadMonthlyTimesheet(currentMonth);
  }
}

async function loadMonthlyTimesheet(month) {
  const el = document.getElementById('ts-monthly-content');
  if (!el) return;
  el.innerHTML = '<div class="spinner-wrap"><div class="spinner"></div></div>';
  try {
    const data = await api.get(`/time-logs/monthly?month=${month}`);
    if (!data.users || data.users.length === 0) {
      el.innerHTML = `<p class="text-muted text-sm" style="text-align:center;padding:20px 0">No punch records for ${month}.</p>`;
      return;
    }
    let html = '';
    for (const user of data.users) {
      const totalHrs = formatMinutes(user.total_minutes);
      html += `<div class="monthly-ts-user">
        <div class="monthly-ts-user-header">
          <div class="user-avatar" style="width:28px;height:28px;font-size:11px;background:${getAvatarColor(user.user_id)}">${getInitials(user.user_name)}</div>
          <span>${escHtml(user.user_name)}</span>
          <span style="font-size:11px;color:var(--text-muted)">${escHtml(user.role_name||'')}</span>
          <span class="monthly-ts-total">${user.records.length} days · ${totalHrs} total</span>
        </div>
        <div class="timesheet-table-wrap"><table class="timesheet-table">
          <thead><tr><th>Date</th><th>Punch In</th><th>Punch Out</th><th>Duration</th></tr></thead>
          <tbody>`;
      for (const r of user.records) {
        html += `<tr>
          <td><span class="text-sm">${formatDate(r.date)}</span></td>
          <td><span class="text-sm">${formatTime12(r.punch_in)}</span></td>
          <td><span class="text-sm">${r.punch_out ? formatTime12(r.punch_out) : '—'}</span></td>
          <td><span class="text-sm">${r.duration_minutes ? formatMinutes(r.duration_minutes) : (r.punch_in && !r.punch_out ? '<span class="text-success">Active</span>' : '—')}</span></td>
        </tr>`;
      }
      html += `</tbody></table></div></div>`;
    }
    el.innerHTML = html;
  } catch(e) {
    el.innerHTML = `<p class="text-muted text-sm" style="color:var(--error)">Failed to load: ${escHtml(e.message)}</p>`;
  }
}

// ═══════════════════════════════════════════════════════════════
// TASKS VIEW
// ═══════════════════════════════════════════════════════════════
async function renderTasks() {
  // Refresh punch log for team members so status/timer lock is correct
  if (!state.user.is_admin) {
    try {
      state.punchLog    = await api.get('/time-logs/today');
      state.activeTimer = await api.get('/tasks/my-active-timer');
    } catch(_) {}
  }

  const tabNames = { all:'All Tasks', daily:'Daily', weekly:'Weekly', monthly:'Monthly' };
  let html = `
    <div class="page-header">
      <div class="page-header-left">
        <h2>Tasks</h2>
        <p>Manage and track all deliverables</p>
      </div>
      ${state.user.is_admin ? `<div class="page-header-actions"><button class="btn btn-primary" onclick="showAddTaskModal()"><i class="fas fa-plus"></i> Add Task</button></div>` : ''}
    </div>
    <div class="view-tabs">
      ${Object.entries(tabNames).map(([k,v]) => `<button class="view-tab ${state.taskView===k?'active':''}" onclick="switchTaskView('${k}')">${v}</button>`).join('')}
    </div>
    <div id="tasks-content">`;

  html += await buildTasksContent(state.taskView);
  html += `</div>`;

  document.getElementById('view-container').innerHTML = html;
}

async function buildTasksContent(view) {
  switch(view) {
    case 'daily':   return buildDailyContent();
    case 'weekly':  return buildWeeklyContent();
    case 'monthly': return buildMonthlyContent();
    default:        return buildAllContent();
  }
}

async function switchTaskView(view) {
  state.taskView = view;
  // Reset date to today when switching views
  if (view === 'daily')   state.taskDate = todayStr();
  if (view === 'weekly')  state.taskDate = getWeekStart(todayStr());
  if (view === 'monthly') state.taskDate = todayStr();

  document.querySelectorAll('.view-tab').forEach(el => el.classList.toggle('active', el.textContent.trim().toLowerCase().replace(' ','') === (['all','daily','weekly','monthly'].includes(view) ? view : view)));
  document.querySelectorAll('.view-tab').forEach((el, i) => {
    const keys = ['all','daily','weekly','monthly'];
    el.classList.toggle('active', keys[i] === view);
  });
  document.getElementById('tasks-content').innerHTML = '<div class="spinner-wrap"><div class="spinner"></div></div>';
  document.getElementById('tasks-content').innerHTML = await buildTasksContent(view);
}

// ── All Tasks ───────────────────────────────────────────────────
async function buildAllContent() {
  const users = state.user.is_admin ? (await api.get('/users').catch(() => [])) : [];
  let params = new URLSearchParams();

  // Apply presetFilter if set (from stat card click), but allow manual filter to override
  let presetStatus  = '';
  let presetOverdue = false;
  let presetActive  = false;
  if (state.presetFilter) {
    if (state.presetFilter.status)  presetStatus  = state.presetFilter.status;
    if (state.presetFilter.overdue) presetOverdue = true;
    if (state.presetFilter.active)  presetActive  = true;
  }

  const statusVal   = document.getElementById('filter-status')?.value   || presetStatus;
  const urgency     = document.getElementById('filter-urgency')?.value  || '';
  const assignee    = document.getElementById('filter-assignee')?.value || '';
  if (statusVal) params.append('status', statusVal);
  if (urgency)   params.append('urgency', urgency);
  if (assignee)  params.append('assignee', assignee);

  let tasks = await api.get('/tasks?' + params.toString());

  // Post-filter for overdue or active (no dedicated API param)
  const today = todayStr();
  if (presetOverdue) tasks = tasks.filter(t => t.deadline < today && t.status !== 'completed');
  if (presetActive)  tasks = tasks.filter(t => t.status !== 'completed');

  let filterNote = '';
  if (state.presetFilter) {
    const label = state.presetFilter.status === 'completed' ? 'Completed Tasks'
      : state.presetFilter.overdue ? 'Overdue Tasks'
      : state.presetFilter.active  ? 'Active Tasks'
      : '';
    filterNote = label ? `<div class="stat-cards-filter-note"><i class="fas fa-filter"></i> Showing: <strong>${label}</strong>
      <button onclick="clearPresetFilter()">Clear filter</button></div>` : '';
  }

  let html = filterNote + `
    <div class="filter-bar">
      <select class="filter-select" id="filter-status" onchange="refreshAllTasks()">
        <option value="">All Statuses</option>
        <option value="pending" ${statusVal==='pending'?'selected':''}>Pending</option>
        <option value="in_progress" ${statusVal==='in_progress'?'selected':''}>In Progress</option>
        <option value="on_hold" ${statusVal==='on_hold'?'selected':''}>On Hold</option>
        <option value="client_feedback" ${statusVal==='client_feedback'?'selected':''}>Client Feedback</option>
        <option value="completed" ${statusVal==='completed'?'selected':''}>Completed</option>
      </select>
      <select class="filter-select" id="filter-urgency" onchange="refreshAllTasks()">
        <option value="">All Urgencies</option>
        <option value="critical">Critical</option>
        <option value="high">High</option>
        <option value="medium">Medium</option>
        <option value="low">Low</option>
      </select>`;
  if (state.user.is_admin) {
    html += `<select class="filter-select" id="filter-assignee" onchange="refreshAllTasks()">
        <option value="">All Members</option>
        ${users.map(u => `<option value="${u.id}">${escHtml(u.name)}</option>`).join('')}
      </select>`;
  }
  html += `<span class="text-muted text-sm" style="margin-left:auto">${tasks.length} task${tasks.length!==1?'s':''}</span>
    </div>`;

  if (tasks.length === 0) {
    html += emptyState('No tasks found', 'Try adjusting your filters or add a new task.', 'fa-list-check');
    return html;
  }

  html += `<div class="card"><div class="task-table-wrap"><table class="task-table">
    <thead><tr>
      <th>Task</th>
      <th>Type</th>
      <th>Urgency</th>
      <th>Assignee</th>
      <th>Deadline</th>
      <th>ETA</th>
      <th>Status</th>
      <th style="width:100px">Actions</th>
    </tr></thead><tbody>`;

  for (const t of tasks) {
    const isOverdue = isPast(t.deadline) && t.status !== 'completed';
    html += `<tr class="clickable-row" onclick="showTaskDetail(${t.id})" title="Click to view details">
      <td class="task-title-cell">
        <div>${escHtml(t.title)}</div>
        ${t.client_name ? `<small><i class="fas fa-building"></i> ${escHtml(t.client_name)}</small>` : ''}
      </td>
      <td><span class="text-sm">${escHtml(t.task_type_name||'—')}</span></td>
      <td>${urgencyBadge(t.urgency)}</td>
      <td>
        ${t.assignee_name
          ? `<div class="flex-center"><div class="user-avatar" style="width:24px;height:24px;font-size:10px;background:${getAvatarColor(t.assigned_to)}">${getInitials(t.assignee_name)}</div><span class="text-sm">${escHtml(t.assignee_name)}</span></div>`
          : `<span class="text-muted text-sm">Unassigned</span>`}
      </td>
      <td><span class="text-sm ${isOverdue?'text-danger':''}">${formatDateShort(t.deadline)}${isOverdue?' ⚠️':''}</span></td>
      <td><span class="text-sm">${t.eta ? formatDateShort(t.eta) : '—'}</span></td>
      <td onclick="event.stopPropagation()">${renderStatusDropdown(t)}</td>
      <td onclick="event.stopPropagation()">${renderTaskActions(t)}</td>
    </tr>`;
  }
  html += `</tbody></table></div></div>`;
  return html;
}

async function refreshAllTasks() {
  // Clear preset filter when user manually changes filter dropdowns
  state.presetFilter = null;
  document.getElementById('tasks-content').innerHTML = await buildAllContent();
}

function clearPresetFilter() {
  state.presetFilter = null;
  refreshAllTasks();
}

// ── Task Detail Modal ────────────────────────────────────────────
async function showTaskDetail(taskId) {
  try {
    const t = await api.get(`/tasks/${taskId}`);
    const isOverdue = isPast(t.deadline) && t.status !== 'completed';
    const progress  = t.progress || 0;

    const html = `
      <div class="task-detail">
        <div class="task-detail-section">
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px">
            ${urgencyBadge(t.urgency)}
            ${statusBadge(t.status)}
            ${t.revision_count > 0 ? `<span class="revision-badge"><i class="fas fa-rotate"></i>${t.revision_count} revision${t.revision_count!==1?'s':''}</span>` : ''}
          </div>
          ${t.description ? `<p style="color:var(--text-muted);font-size:13px;line-height:1.6;margin-bottom:0">${escHtml(t.description)}</p>` : ''}
        </div>

        <div class="task-detail-grid">
          <div class="task-detail-item">
            <div class="task-detail-label"><i class="fas fa-tag"></i> Task Type</div>
            <div class="task-detail-value">${escHtml(t.task_type_name||'—')}</div>
          </div>
          ${t.client_name ? `
          <div class="task-detail-item">
            <div class="task-detail-label"><i class="fas fa-building"></i> Client</div>
            <div class="task-detail-value">${escHtml(t.client_name)}</div>
          </div>` : ''}
          <div class="task-detail-item">
            <div class="task-detail-label"><i class="fas fa-user"></i> Assigned To</div>
            <div class="task-detail-value">
              ${t.assignee_name
                ? `<div class="flex-center" style="gap:6px"><div class="user-avatar" style="width:22px;height:22px;font-size:9px;background:${getAvatarColor(t.assigned_to)}">${getInitials(t.assignee_name)}</div>${escHtml(t.assignee_name)}</div>`
                : '<span class="text-muted">Unassigned</span>'}
            </div>
          </div>
          <div class="task-detail-item">
            <div class="task-detail-label"><i class="fas fa-flag"></i> Deadline</div>
            <div class="task-detail-value ${isOverdue?'text-danger':''}">${formatDate(t.deadline)}${isOverdue?' ⚠️':''}</div>
          </div>
          ${t.eta ? `
          <div class="task-detail-item">
            <div class="task-detail-label"><i class="fas fa-clock"></i> ETA</div>
            <div class="task-detail-value eta-badge-text">${formatDate(t.eta)}</div>
          </div>` : ''}
          <div class="task-detail-item">
            <div class="task-detail-label"><i class="fas fa-calendar-plus"></i> Created</div>
            <div class="task-detail-value text-muted text-sm">${formatDate(t.created_at ? t.created_at.split(/[ T]/)[0] : '')}</div>
          </div>
          ${t.completed_at ? `
          <div class="task-detail-item">
            <div class="task-detail-label"><i class="fas fa-circle-check"></i> Completed</div>
            <div class="task-detail-value" style="color:var(--success)">${formatDate(t.completed_at.split(/[ T]/)[0])}</div>
          </div>` : ''}
        </div>

        <div style="margin-top:16px">
          <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:6px">
            <span class="text-muted">Progress</span>
            <span style="font-weight:600">${progress}%</span>
          </div>
          <div class="progress-bar-thin" style="height:8px">
            <div class="progress-bar-thin-fill ${t.status==='completed'?'done':''}" style="width:${progress}%"></div>
          </div>
        </div>

        ${t.feedback_notes ? `
        <div style="margin-top:16px;padding:12px;background:#fef3c7;border-radius:8px;border-left:3px solid #f59e0b">
          <div style="font-size:11px;font-weight:700;color:#92400e;text-transform:uppercase;margin-bottom:4px"><i class="fas fa-comment-dots"></i> Client Feedback</div>
          <div style="font-size:13px;color:#78350f">${escHtml(t.feedback_notes)}</div>
        </div>` : ''}

        <div style="display:flex;gap:8px;margin-top:20px;justify-content:flex-end">
          <button class="btn btn-outline" onclick="closeModal()">Close</button>
          <button class="btn btn-primary" onclick="closeModal(); showEditTaskModal(${t.id})"><i class="fas fa-pen"></i> Edit Task</button>
        </div>
      </div>`;

    showModal(escHtml(t.title), html, null);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ── Daily Tasks ─────────────────────────────────────────────────
async function buildDailyContent() {
  const date  = state.taskDate;
  const daily = await api.get(`/dashboard/daily?date=${date}`);
  const today = todayStr();

  let html = `
    <div class="date-nav">
      <button class="btn btn-outline btn-sm" onclick="shiftDate(-1)"><i class="fas fa-chevron-left"></i></button>
      <div class="date-nav-label">
        ${formatDate(date)} ${isToday(date) ? '<span class="today-pill">Today</span>' : ''}
      </div>
      <button class="btn btn-outline btn-sm" onclick="shiftDate(1)"><i class="fas fa-chevron-right"></i></button>
      <input type="date" class="filter-select" style="max-width:160px" value="${date}" onchange="setDate(this.value)">
      <span class="text-muted text-sm" style="margin-left:auto">${daily.total} task${daily.total!==1?'s':''}</span>
    </div>`;

  if (!daily.groups || daily.groups.length === 0) {
    html += `<div class="empty-state">
      <div class="empty-icon"><i class="fas fa-calendar-xmark"></i></div>
      <h3>No tasks for this day</h3>
      <p>No tasks have a deadline falling on ${formatDate(date)}.</p>
      <p class="text-muted text-sm" style="margin-top:8px">Tasks are shown here by their deadline date. Use the arrows to navigate to other dates, or check <strong>All Tasks</strong> to see everything.</p>
      <div style="display:flex;gap:8px;justify-content:center;margin-top:16px">
        <button class="btn btn-outline btn-sm" onclick="shiftDate(-1)"><i class="fas fa-chevron-left"></i> Prev Day</button>
        <button class="btn btn-outline btn-sm" onclick="switchTaskView('all')"><i class="fas fa-list-check"></i> View All Tasks</button>
        <button class="btn btn-outline btn-sm" onclick="shiftDate(1)">Next Day <i class="fas fa-chevron-right"></i></button>
      </div>
    </div>`;
    return html;
  }

  for (const group of daily.groups) {
    html += `
      <div class="daily-group">
        <div class="daily-group-header">
          <div class="daily-group-avatar" style="background:${getAvatarColor(group.assignee_id)}">${getInitials(group.assignee_name)}</div>
          <div class="daily-group-info">
            <h4>${escHtml(group.assignee_name)}</h4>
            <span>${escHtml(group.role_name||'')}</span>
          </div>
          <span class="daily-group-count">${group.tasks.length} task${group.tasks.length!==1?'s':''}</span>
        </div>
        <div class="task-list">`;
    for (const t of group.tasks) {
      html += renderTaskCard(t);
    }
    html += `</div></div>`;
  }
  return html;
}

// ── Weekly Tasks ─────────────────────────────────────────────────
async function buildWeeklyContent() {
  const weekStart = getWeekStart(state.taskDate);
  const data = await api.get(`/dashboard/weekly?date=${weekStart}`);

  let html = `
    <div class="date-nav">
      <button class="btn btn-outline btn-sm" onclick="shiftWeek(-1)"><i class="fas fa-chevron-left"></i></button>
      <div class="date-nav-label">Week of ${getWeekLabel(data.weekStart, data.weekEnd)}</div>
      <button class="btn btn-outline btn-sm" onclick="shiftWeek(1)"><i class="fas fa-chevron-right"></i></button>
      <span class="text-muted text-sm" style="margin-left:auto">${data.total} task${data.total!==1?'s':''} this week</span>
    </div>`;

  if (data.total === 0) {
    html += `<div class="empty-state">
      <div class="empty-icon"><i class="fas fa-calendar-week"></i></div>
      <h3>No tasks this week</h3>
      <p>No tasks have deadlines falling in this week.</p>
      <p class="text-muted text-sm" style="margin-top:8px">Navigate to other weeks or check <strong>All Tasks</strong> to see all tasks regardless of date.</p>
      <div style="display:flex;gap:8px;justify-content:center;margin-top:16px">
        <button class="btn btn-outline btn-sm" onclick="shiftWeek(-1)"><i class="fas fa-chevron-left"></i> Prev Week</button>
        <button class="btn btn-outline btn-sm" onclick="switchTaskView('all')"><i class="fas fa-list-check"></i> View All Tasks</button>
        <button class="btn btn-outline btn-sm" onclick="shiftWeek(1)">Next Week <i class="fas fa-chevron-right"></i></button>
      </div>
    </div>`;
    return html;
  }

  // Build all days Mon–Sat
  const dayMap = {};
  for (const d of (data.days||[])) dayMap[d.date] = d;

  for (let i = 0; i < 6; i++) {
    const date = addDays(data.weekStart, i);
    const day  = dayMap[date] || { date, tasks: [] };
    const taskCount = day.tasks.length;
    html += `
      <div class="weekly-day">
        <div class="weekly-day-header">
          <span class="weekly-day-name">${DAY_NAMES[new Date(date+'T12:00:00').getDay()]}</span>
          <span class="weekly-day-date">${formatDateShort(date)}</span>
          ${isToday(date) ? '<span class="today-pill">Today</span>' : ''}
          <span class="weekly-day-count text-muted text-sm" style="margin-left:auto">${taskCount} task${taskCount!==1?'s':''}</span>
        </div>`;
    if (taskCount === 0) {
      html += `<p class="text-muted text-sm" style="padding:8px 0;color:var(--text-muted)"><i class="fas fa-minus"></i> No tasks</p>`;
    } else {
      html += `<div class="task-list">`;
      for (const t of day.tasks) html += renderTaskCard(t, true);
      html += `</div>`;
    }
    html += `</div>`;
  }
  return html;
}

// ── Monthly Tasks ───────────────────────────────────────────────
async function buildMonthlyContent() {
  const data = await api.get(`/dashboard/monthly?date=${state.taskDate}`);

  let html = `
    <div class="date-nav">
      <button class="btn btn-outline btn-sm" onclick="shiftMonth(-1)"><i class="fas fa-chevron-left"></i></button>
      <div class="date-nav-label">${getMonthLabel(data.monthStart)}</div>
      <button class="btn btn-outline btn-sm" onclick="shiftMonth(1)"><i class="fas fa-chevron-right"></i></button>
      <span class="text-muted text-sm" style="margin-left:auto">${data.total} task${data.total!==1?'s':''} this month</span>
    </div>`;

  if (!data.tasks || data.tasks.length === 0) {
    html += `<div class="empty-state">
      <div class="empty-icon"><i class="fas fa-calendar"></i></div>
      <h3>No tasks this month</h3>
      <p>No tasks have deadlines in ${getMonthLabel(data.monthStart)}.</p>
      <p class="text-muted text-sm" style="margin-top:8px">Navigate to other months or check <strong>All Tasks</strong> to see everything.</p>
      <div style="display:flex;gap:8px;justify-content:center;margin-top:16px">
        <button class="btn btn-outline btn-sm" onclick="shiftMonth(-1)"><i class="fas fa-chevron-left"></i> Prev Month</button>
        <button class="btn btn-outline btn-sm" onclick="switchTaskView('all')"><i class="fas fa-list-check"></i> View All Tasks</button>
        <button class="btn btn-outline btn-sm" onclick="shiftMonth(1)">Next Month <i class="fas fa-chevron-right"></i></button>
      </div>
    </div>`;
    return html;
  }

  // Group by deadline date
  const byDate = {};
  for (const t of data.tasks) {
    if (!byDate[t.deadline]) byDate[t.deadline] = [];
    byDate[t.deadline].push(t);
  }

  html += `<div class="month-summary">`;
  for (const [date, tasks] of Object.entries(byDate).sort()) {
    html += `
      <div class="month-day-card">
        <div class="month-day-header">
          <span class="day-label ${isToday(date)?'today-label':''}">${DAY_NAMES[new Date(date+'T12:00:00').getDay()]}, ${formatDateShort(date)}${isToday(date)?' — Today':''}</span>
          <span class="badge badge-medium">${tasks.length}</span>
        </div>
        <div class="month-day-tasks">`;
    for (const t of tasks) {
      html += `
        <div style="display:flex;align-items:flex-start;gap:8px;padding:6px 0;border-bottom:1px solid var(--border)">
          <div>${urgencyBadge(t.urgency)}</div>
          <div style="flex:1;min-width:0">
            <div style="font-size:13px;font-weight:500;line-height:1.3">${escHtml(t.title)}</div>
            <div style="font-size:11px;color:var(--text-muted);margin-top:2px">
              ${t.assignee_name ? `<i class="fas fa-user"></i> ${escHtml(t.assignee_name)}` : 'Unassigned'}
              · ${escHtml(t.task_type_name||'')}
            </div>
          </div>
          <div>${statusBadge(t.status)}</div>
        </div>`;
    }
    html += `</div></div>`;
  }
  html += `</div>`;
  return html;
}

// ── Date navigation helpers ──────────────────────────────────────
async function shiftDate(n) {
  state.taskDate = addDays(state.taskDate, n);
  document.getElementById('tasks-content').innerHTML = await buildDailyContent();
}
async function setDate(val) {
  state.taskDate = val;
  document.getElementById('tasks-content').innerHTML = await buildDailyContent();
}
async function shiftWeek(n) {
  state.taskDate = addDays(getWeekStart(state.taskDate), n * 7);
  document.getElementById('tasks-content').innerHTML = await buildWeeklyContent();
}
async function shiftMonth(n) {
  const d = new Date(state.taskDate + 'T12:00:00');
  d.setDate(1); // Avoid overflow when shifting months
  d.setMonth(d.getMonth() + n);
  // Build YYYY-MM-DD directly to avoid timezone offset issues
  const y = d.getFullYear(), m = d.getMonth() + 1;
  state.taskDate = `${y}-${String(m).padStart(2,'0')}-01`;
  document.getElementById('tasks-content').innerHTML = await buildMonthlyContent();
}

// ── Task Card Renderer ───────────────────────────────────────────
function renderTaskCard(t, showAssignee = false) {
  const isOverdue      = isPast(t.deadline) && t.status !== 'completed';
  const progress       = t.progress || 0;
  const isRunning      = state.activeTimer && state.activeTimer.task_id === t.id;
  const revCount       = t.revision_count || 0;
  const isDone         = t.status === 'completed';

  // Progress bar fill color
  const fillClass = isDone ? 'done' : '';

  // Punch state for team members
  const isAssignedToMe = !state.user.is_admin && t.assigned_to === state.user.id;
  const isPunchedIn    = state.punchLog && state.punchLog.punch_in && !state.punchLog.punch_out;
  const isPunchedOut   = state.punchLog && state.punchLog.punch_in && state.punchLog.punch_out;

  // Timer display — only for the assigned team member, only when punched in
  let timerSection = '';
  if (!isDone && isAssignedToMe) {
    if (!state.punchLog || !state.punchLog.punch_in) {
      // Not punched in yet — show hint
      timerSection = `<div class="task-timer-row"><span class="punch-required-hint"><i class="fas fa-lock"></i> Punch in to enable timer</span></div>`;
    } else if (isPunchedOut) {
      // Punched out — show locked
      timerSection = `<div class="task-timer-row"><span class="punch-required-hint"><i class="fas fa-lock"></i> Punched out for today</span></div>`;
    } else if (t.status !== 'in_progress') {
      // Punched in but not in_progress — show hint
      timerSection = `<div class="task-timer-row"><span class="punch-required-hint"><i class="fas fa-clock"></i> Set status to In Progress to start timer</span></div>`;
    } else {
      // Punched in AND in_progress — show timer controls
      const timerVal = isRunning
        ? `<span class="timer-display" data-task-id="${t.id}">${formatSeconds(Math.floor((Date.now() - new Date(state.activeTimer.started_at)) / 1000))}</span>`
        : `<span class="timer-display stopped" data-task-id="${t.id}">00:00:00</span>`;
      const timerBtn = isRunning
        ? `<button class="timer-stop-btn" onclick="stopTaskTimer(${t.id})"><i class="fas fa-stop"></i> Stop</button>`
        : `<button class="timer-start-btn" onclick="startTaskTimer(${t.id})"><i class="fas fa-play"></i> Start</button>`;
      timerSection = `<div class="task-timer-row">${timerVal}${timerBtn}</div>`;
    }
  }

  // Feedback button (shown to team members on non-completed, non-client_feedback tasks)
  const feedbackBtn = (isAssignedToMe && !isDone && t.status !== 'client_feedback' && isPunchedIn)
    ? `<button class="feedback-btn" title="Mark as Client Feedback" onclick="showFeedbackModal(${t.id}, '${escHtml(t.title.replace(/'/g,"\\'"))}')"><i class="fas fa-comment-dots"></i> Feedback</button>`
    : '';

  // Description click hint (for team members with description)
  const titleClickable = t.description ? `style="cursor:pointer" onclick="showTaskDescriptionModal(${t.id})" title="Click to view description"` : '';

  return `
    <div class="task-card urgency-${t.urgency} status-${t.status}">
      <div class="task-card-top">
        <div class="task-card-title ${isDone?'completed-text':''}" ${titleClickable}>${escHtml(t.title)}${t.description ? ' <i class="fas fa-info-circle" style="font-size:10px;color:var(--text-muted);margin-left:3px"></i>' : ''}</div>
        <div class="task-card-actions">
          ${revCount > 0 ? `<span class="revision-badge"><i class="fas fa-rotate"></i>${revCount}</span>` : ''}
          ${renderTaskActions(t)}
        </div>
      </div>
      <div class="task-card-meta">
        ${t.client_name ? `<span class="meta-item"><i class="fas fa-building"></i>${escHtml(t.client_name)}</span>` : ''}
        <span class="meta-item"><i class="fas fa-tag"></i>${escHtml(t.task_type_name||'')}</span>
        ${showAssignee && t.assignee_name ? `<span class="meta-item"><i class="fas fa-user"></i>${escHtml(t.assignee_name)}</span>` : ''}
        <span class="meta-item ${isOverdue?'text-danger':''}"><i class="fas fa-flag"></i>Due: ${formatDateShort(t.deadline)}${isOverdue?' ⚠️':''}</span>
        ${t.eta ? `<span class="meta-item eta-badge"><i class="fas fa-clock"></i>ETA: ${formatDateShort(t.eta)}</span>` : ''}
        ${t.feedback_notes ? `<span class="meta-item" style="color:#92400e"><i class="fas fa-comment"></i>${escHtml(t.feedback_notes)}</span>` : ''}
      </div>
      ${timerSection}
      <div class="progress-row">
        <input type="range" class="progress-slider" min="0" max="100" value="${progress}"
          ${(isDone || (isAssignedToMe && isPunchedOut))?'disabled':''} oninput="this.nextElementSibling.textContent=this.value+'%'"
          onchange="saveTaskProgress(${t.id}, this.value)">
        <span class="progress-pct">${progress}%</span>
      </div>
      <div class="progress-bar-thin">
        <div class="progress-bar-thin-fill ${fillClass}" style="width:${progress}%"></div>
      </div>
      <div class="task-card-footer">
        ${urgencyBadge(t.urgency)}
        ${renderStatusDropdown(t)}
        ${feedbackBtn}
      </div>
    </div>`;
}

// ── Task Description Modal (for team members) ─────────────────────
async function showTaskDescriptionModal(taskId) {
  try {
    const t = await api.get(`/tasks/${taskId}`);
    const html = `
      <div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">
          ${urgencyBadge(t.urgency)} ${statusBadge(t.status)}
        </div>
        ${t.client_name ? `<div style="font-size:12px;color:var(--text-muted);margin-bottom:10px"><i class="fas fa-building"></i> ${escHtml(t.client_name)}</div>` : ''}
        <div style="font-size:13px;line-height:1.7;color:var(--text);white-space:pre-wrap">${escHtml(t.description || 'No description provided.')}</div>
        <div style="margin-top:16px;display:flex;gap:10px;font-size:12px;color:var(--text-muted)">
          <span><i class="fas fa-flag"></i> Due: ${formatDate(t.deadline)}</span>
          ${t.eta ? `<span><i class="fas fa-clock"></i> ETA: ${formatDate(t.eta)}</span>` : ''}
        </div>
        <div style="margin-top:16px;text-align:right">
          <button class="btn btn-outline" onclick="closeModal()">Close</button>
        </div>
      </div>`;
    showModal(escHtml(t.title), html, null);
  } catch(e) { showToast(e.message, 'error'); }
}

function renderStatusDropdown(t) {
  const opts = [
    {v:'pending',         l:'Pending'},
    {v:'in_progress',     l:'In Progress'},
    {v:'on_hold',         l:'On Hold'},
    {v:'client_feedback', l:'Client Feedback'},
    {v:'completed',       l:'Completed'},
  ];

  // Team members: disable status change if not punched in or already punched out
  const isAssignedToMe = !state.user.is_admin && t.assigned_to === state.user.id;
  const isPunchedIn  = state.punchLog && state.punchLog.punch_in && !state.punchLog.punch_out;
  const isPunchedOut = state.punchLog && state.punchLog.punch_in  && state.punchLog.punch_out;
  const locked = isAssignedToMe && (!state.punchLog || !state.punchLog.punch_in || isPunchedOut);

  if (locked) {
    return `<span class="badge badge-${t.status}" title="${isPunchedOut ? 'Punched out for today' : 'Punch in to update status'}" style="opacity:0.6">${STATUS_LABEL[t.status]||t.status}</span>`;
  }

  return `<select class="badge badge-${t.status}" style="border:none;cursor:pointer;background:transparent;padding:3px 6px;font-size:11px;font-weight:600;border-radius:20px"
    data-prev="${t.status}" onchange="updateStatus(${t.id}, this.value, this)">
    ${opts.map(o => `<option value="${o.v}" ${t.status===o.v?'selected':''}>${o.l}</option>`).join('')}
  </select>`;
}

function renderTaskActions(t) {
  if (!state.user.is_admin) return ''; // Team members can only update status
  const editBtn   = `<button class="btn-icon" title="Edit" onclick="showEditTaskModal(${t.id})"><i class="fas fa-pen text-muted"></i></button>`;
  const deleteBtn = `<button class="btn-icon" title="Delete" onclick="deleteTask(${t.id}, '${escHtml(t.title.replace(/'/g,"\\\'"))}')"><i class="fas fa-trash text-danger"></i></button>`;
  return editBtn + deleteBtn;
}

// ── Task CRUD ────────────────────────────────────────────────────
async function updateStatus(id, status, selectEl) {
  const prev = selectEl.dataset.prev || selectEl.value;
  try {
    // If status changes to completed or client_feedback, auto-stop running timer
    if ((status === 'completed' || status === 'client_feedback') && state.activeTimer && state.activeTimer.task_id === id) {
      try {
        await api.post(`/tasks/${id}/timer/stop`, {});
        state.activeTimer = null;
        clearInterval(state.timerInterval);
      } catch(_) {}
    }

    await api.put(`/tasks/${id}`, { status });
    selectEl.className = `badge badge-${status}`;
    selectEl.dataset.prev = status;
    showToast(`Status updated to ${STATUS_LABEL[status]}`);

    // Re-render task card to update timer state (locked/unlocked based on new status)
    renderView();
  } catch (err) {
    selectEl.value = prev;
    showToast(err.message, 'error');
  }
}

async function deleteTask(id, title) {
  showConfirm(
    `Delete task "${title}"? This cannot be undone.`,
    async () => {
      try {
        await api.del(`/tasks/${id}`);
        showToast('Task deleted');
        renderView();
      } catch (err) {
        showToast(err.message, 'error');
      }
    }
  );
}

// ── Add Task Modal ───────────────────────────────────────────────
async function showAddTaskModal() {
  if (state.taskTypes.length === 0) state.taskTypes = await api.get('/task-types');

  const typeOptions = state.taskTypes.map(tt =>
    `<option value="${tt.id}" data-role="${tt.role_id}">${escHtml(tt.name)} (${escHtml(tt.role_name||'')})</option>`
  ).join('');

  const html = `
    <form id="task-form">
      <div class="form-row">
        <div class="form-group">
          <label>Task Title <span class="required">*</span></label>
          <input type="text" name="title" placeholder="e.g. Instagram reel for XYZ" required />
        </div>
        <div class="form-group">
          <label>Client Name</label>
          <input type="text" name="client_name" placeholder="e.g. ABC Pvt. Ltd." />
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Task Type <span class="required">*</span></label>
          <select name="task_type_id" id="task-type-sel" required onchange="previewAssignment()">
            <option value="">Select type…</option>
            ${typeOptions}
          </select>
        </div>
        <div class="form-group">
          <label>Urgency</label>
          <select name="urgency">
            <option value="low">Low</option>
            <option value="medium" selected>Medium</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
          </select>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Deadline <span class="required">*</span></label>
          <input type="date" name="deadline" id="task-deadline-inp" min="${todayStr()}" required onchange="previewAssignment()" />
        </div>
        <div class="form-group">
          <label>ETA <span class="form-hint" style="display:inline">(estimated completion)</span></label>
          <input type="date" name="eta" />
        </div>
      </div>

      <div id="assignment-preview" style="display:none" class="assign-preview">
        <i class="fas fa-robot"></i>
        <span id="assign-preview-text">Auto-assigning…</span>
      </div>

      <div class="form-group" id="assignee-group" style="display:none">
        <label>Assign To <span class="form-hint" style="display:inline">(auto-selected by workload)</span></label>
        <select name="assigned_to" id="assignee-sel">
          <option value="">— Let system decide —</option>
        </select>
      </div>

      <div class="form-group">
        <label>Description / Notes</label>
        <textarea name="description" placeholder="Any additional details…" rows="3"></textarea>
      </div>

      <div class="form-actions">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary"><i class="fas fa-plus"></i> Add Task</button>
      </div>
    </form>`;

  showModal('Add New Task', html, async (formData) => {
    const payload = {
      title:       formData.get('title'),
      client_name: formData.get('client_name') || null,
      task_type_id: parseInt(formData.get('task_type_id')),
      urgency:     formData.get('urgency'),
      deadline:    formData.get('deadline'),
      description: formData.get('description') || null,
      eta:         formData.get('eta') || null,
    };
    const assignedTo = formData.get('assigned_to');
    if (assignedTo) payload.assigned_to = parseInt(assignedTo);

    const task = await api.post('/tasks', payload);
    showToast(`✅ Task created and assigned to ${task.assignee_name || 'Unassigned'}`);
    renderView();
  });
}

// Called when task type or deadline changes in Add Task modal
let _previewTimeout = null;
async function previewAssignment() {
  clearTimeout(_previewTimeout);
  _previewTimeout = setTimeout(async () => {
    const typeId  = document.getElementById('task-type-sel')?.value;
    const deadline = document.getElementById('task-deadline-inp')?.value;
    if (!typeId || !deadline) return;

    const previewBox  = document.getElementById('assignment-preview');
    const previewText = document.getElementById('assign-preview-text');
    const assigneeGrp = document.getElementById('assignee-group');
    const assigneeSel = document.getElementById('assignee-sel');

    previewBox.style.display = 'flex';
    previewText.textContent  = 'Calculating best assignment…';

    try {
      const data = await api.get(`/tasks/assignment-preview?task_type_id=${typeId}&deadline=${deadline}`);
      const suggested = data.available_users.find(u => u.id === data.suggested_user_id);
      previewText.innerHTML = `Will be assigned to <strong>${suggested ? suggested.name : 'Unassigned'}</strong>. Override below if needed.`;

      // Populate override dropdown
      if (assigneeSel && data.available_users.length > 0) {
        assigneeSel.innerHTML = '<option value="">— System choice —</option>' +
          data.available_users.map(u =>
            `<option value="${u.id}" ${u.id === data.suggested_user_id ? 'selected' : ''}>${escHtml(u.name)} (${u.active_tasks} active)</option>`
          ).join('');
        assigneeGrp.style.display = 'block';
      }
    } catch(e) {
      previewText.textContent = 'Could not preview assignment — check task type and deadline.';
    }
  }, 400);
}

// ── Edit Task Modal ──────────────────────────────────────────────
async function showEditTaskModal(taskId) {
  if (state.taskTypes.length === 0) state.taskTypes = await api.get('/task-types');
  const task = await api.get(`/tasks/${taskId}`);

  const typeOpts = state.taskTypes.map(tt =>
    `<option value="${tt.id}" ${task.task_type_id===tt.id?'selected':''}>${escHtml(tt.name)} (${escHtml(tt.role_name||'')})</option>`
  ).join('');

  let assigneeOpts = '';
  if (state.user.is_admin) {
    const roleId = state.taskTypes.find(t => t.id === task.task_type_id)?.role_id;
    if (roleId) {
      const teamMembers = await api.get('/users').catch(() => []);
      const roleUsers = teamMembers.filter(u => u.role_id === roleId);
      assigneeOpts = `
        <div class="form-group">
          <label>Assigned To</label>
          <select name="assigned_to">
            <option value="">Unassigned</option>
            ${roleUsers.map(u => `<option value="${u.id}" ${task.assigned_to===u.id?'selected':''}>${escHtml(u.name)}</option>`).join('')}
          </select>
        </div>`;
    }
  }

  const html = `
    <form id="edit-task-form">
      <div class="form-row">
        <div class="form-group">
          <label>Title</label>
          <input type="text" name="title" value="${escHtml(task.title)}" required />
        </div>
        <div class="form-group">
          <label>Client</label>
          <input type="text" name="client_name" value="${escHtml(task.client_name||'')}" />
        </div>
      </div>
      ${state.user.is_admin ? `
      <div class="form-row">
        <div class="form-group">
          <label>Task Type</label>
          <select name="task_type_id">${typeOpts}</select>
        </div>
        <div class="form-group">
          <label>Urgency</label>
          <select name="urgency">
            ${['low','medium','high','critical'].map(u => `<option value="${u}" ${task.urgency===u?'selected':''}>${URGENCY_LABEL[u]}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Deadline</label>
          <input type="date" name="deadline" value="${task.deadline}" required />
        </div>
        <div class="form-group">
          <label>ETA <span class="form-hint" style="display:inline">(estimated completion)</span></label>
          <input type="date" name="eta" value="${task.eta||''}" />
        </div>
      </div>
      ${assigneeOpts}
      <div class="form-group">
        <label>Status</label>
        <select name="status">
          ${Object.entries(STATUS_LABEL).map(([v,l]) => `<option value="${v}" ${task.status===v?'selected':''}>${l}</option>`).join('')}
        </select>
      </div>` : `<div class="form-group"><label>Status</label><select name="status">
        ${Object.entries(STATUS_LABEL).map(([v,l]) => `<option value="${v}" ${task.status===v?'selected':''}>${l}</option>`).join('')}
      </select></div>`}
      <div class="form-group">
        <label>Description</label>
        <textarea name="description" rows="3">${escHtml(task.description||'')}</textarea>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary">Save Changes</button>
      </div>
    </form>`;

  showModal('Edit Task', html, async (formData) => {
    const payload = {};
    ['title','client_name','task_type_id','urgency','deadline','description','assigned_to','status','eta'].forEach(k => {
      const v = formData.get(k);
      if (v !== null) payload[k] = v || null;
    });
    if (payload.task_type_id) payload.task_type_id = parseInt(payload.task_type_id);
    if (payload.assigned_to)  payload.assigned_to  = parseInt(payload.assigned_to);

    await api.put(`/tasks/${taskId}`, payload);
    showToast('Task updated');
    renderView();
  });
}

// ═══════════════════════════════════════════════════════════════
// TEAM VIEW (Admin)
// ═══════════════════════════════════════════════════════════════
async function renderTeam() {
  const [users, roles] = await Promise.all([api.get('/users'), api.get('/roles')]);
  state.roles = roles;

  let html = `
    <div class="page-header">
      <div class="page-header-left">
        <h2>Team</h2>
        <p>${users.length} active member${users.length!==1?'s':''}</p>
      </div>
      <div class="page-header-actions">
        <button class="btn btn-primary" onclick="showAddUserModal()"><i class="fas fa-user-plus"></i> Add Member</button>
      </div>
    </div>`;

  if (users.length === 0) {
    html += emptyState('No team members yet', 'Add your first team member to get started.', 'fa-users');
    document.getElementById('view-container').innerHTML = html;
    return;
  }

  // Group by role
  const byRole = {};
  for (const u of users) {
    const rn = u.role_name || 'No Role';
    if (!byRole[rn]) byRole[rn] = [];
    byRole[rn].push(u);
  }

  for (const [roleName, members] of Object.entries(byRole)) {
    html += `<h4 style="font-size:13px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:12px">${escHtml(roleName)} (${members.length})</h4>`;
    html += `<div class="team-grid" style="margin-bottom:24px">`;
    for (const u of members) {
      html += `
        <div class="team-card">
          <div class="team-card-top">
            <div class="team-avatar" style="background:${getAvatarColor(u.id)}">${getInitials(u.name)}</div>
            <div class="team-info">
              <div class="team-name">${escHtml(u.name)}</div>
              <div class="team-role">${escHtml(u.role_name||'No Role')}</div>
              <div class="text-sm text-muted" style="margin-top:2px">${escHtml(u.email)}</div>
            </div>
            <div class="team-actions">
              <button class="btn-icon" title="Edit" onclick="showEditUserModal(${u.id})"><i class="fas fa-pen text-muted"></i></button>
              <button class="btn-icon" title="Remove" onclick="removeUser(${u.id},'${escHtml(u.name.replace(/'/g,"\\'"))}')"><i class="fas fa-trash text-danger"></i></button>
            </div>
          </div>
          <div class="team-stats">
            <div class="team-stat">
              <div class="team-stat-value active-color">${u.active_tasks}</div>
              <div class="team-stat-label">Active</div>
            </div>
            <div class="team-stat">
              <div class="team-stat-value complete-color">${u.completed_tasks}</div>
              <div class="team-stat-label">Done</div>
            </div>
            <div class="team-stat">
              <div class="team-stat-value">${u.active_tasks + u.completed_tasks}</div>
              <div class="team-stat-label">Total</div>
            </div>
          </div>
        </div>`;
    }
    html += `</div>`;
  }

  document.getElementById('view-container').innerHTML = html;
}

async function showAddUserModal() {
  if (state.roles.length === 0) state.roles = await api.get('/roles');
  const roleOpts = state.roles.map(r => `<option value="${r.id}">${escHtml(r.name)}</option>`).join('');

  const html = `
    <form id="add-user-form">
      <div class="form-row">
        <div class="form-group">
          <label>Full Name <span class="required">*</span></label>
          <input type="text" name="name" placeholder="e.g. Priya Sharma" required />
        </div>
        <div class="form-group">
          <label>Email <span class="required">*</span></label>
          <input type="email" name="email" placeholder="priya@agency.com" required />
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Password <span class="required">*</span></label>
          <input type="password" name="password" placeholder="••••••••" required />
        </div>
        <div class="form-group">
          <label>Role <span class="required">*</span></label>
          <div style="display:flex;gap:6px;align-items:center">
            <select name="role_id" id="add-user-role-sel" required style="flex:1">
              <option value="">Select role…</option>
              ${roleOpts}
            </select>
            <button type="button" class="btn btn-outline btn-sm" title="Create new role" onclick="toggleNewRoleInput()" style="white-space:nowrap">
              <i class="fas fa-plus"></i> New
            </button>
          </div>
        </div>
      </div>
      <div id="new-role-row" style="display:none;margin-bottom:14px">
        <div class="form-group" style="margin-bottom:0">
          <label>New Role Name</label>
          <div style="display:flex;gap:6px">
            <input type="text" id="new-role-input" placeholder="e.g. Motion Designer" style="flex:1" />
            <button type="button" class="btn btn-primary btn-sm" onclick="createRoleInline()">
              <i class="fas fa-check"></i> Create
            </button>
          </div>
        </div>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary"><i class="fas fa-user-plus"></i> Add Member</button>
      </div>
    </form>`;

  showModal('Add Team Member', html, async (formData) => {
    await api.post('/users', {
      name:     formData.get('name'),
      email:    formData.get('email'),
      password: formData.get('password'),
      role_id:  parseInt(formData.get('role_id')),
    });
    showToast('Team member added');
    renderTeam();
  });
}

function toggleNewRoleInput() {
  const row = document.getElementById('new-role-row');
  if (!row) return;
  const show = row.style.display === 'none';
  row.style.display = show ? 'block' : 'none';
  if (show) document.getElementById('new-role-input').focus();
}

async function createRoleInline() {
  const input = document.getElementById('new-role-input');
  const name  = input?.value?.trim();
  if (!name) { showToast('Enter a role name', 'warning'); return; }
  try {
    const newRole = await api.post('/roles', { name });
    // Refresh roles list and update the dropdown
    state.roles = await api.get('/roles');
    const sel = document.getElementById('add-user-role-sel');
    if (sel) {
      sel.innerHTML = '<option value="">Select role…</option>' +
        state.roles.map(r => `<option value="${r.id}" ${r.id === newRole.id ? 'selected' : ''}>${escHtml(r.name)}</option>`).join('');
    }
    // Hide new role row
    document.getElementById('new-role-row').style.display = 'none';
    showToast(`Role "${name}" created and selected`);
  } catch (e) { showToast(e.message, 'error'); }
}

async function showEditUserModal(userId) {
  if (state.roles.length === 0) state.roles = await api.get('/roles');
  const users = await api.get('/users');
  const u = users.find(x => x.id === userId);
  if (!u) return showToast('User not found', 'error');

  const roleOpts = state.roles.map(r =>
    `<option value="${r.id}" ${u.role_id===r.id?'selected':''}>${escHtml(r.name)}</option>`
  ).join('');

  const html = `
    <form>
      <div class="form-row">
        <div class="form-group">
          <label>Full Name</label>
          <input type="text" name="name" value="${escHtml(u.name)}" required />
        </div>
        <div class="form-group">
          <label>Email</label>
          <input type="email" name="email" value="${escHtml(u.email)}" required />
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>New Password <span class="form-hint">(leave blank to keep current)</span></label>
          <input type="password" name="password" placeholder="••••••••" />
        </div>
        <div class="form-group">
          <label>Role</label>
          <select name="role_id">
            <option value="">No Role</option>
            ${roleOpts}
          </select>
        </div>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary">Save Changes</button>
      </div>
    </form>`;

  showModal(`Edit — ${u.name}`, html, async (formData) => {
    const payload = {
      name:    formData.get('name'),
      email:   formData.get('email'),
      role_id: parseInt(formData.get('role_id')) || null,
    };
    const pw = formData.get('password');
    if (pw) payload.password = pw;
    await api.put(`/users/${userId}`, payload);
    showToast('Member updated');
    renderTeam();
  });
}

async function removeUser(id, name) {
  showConfirm(
    `Remove "${name}" from the team? Their pending tasks will be unassigned.`,
    async () => {
      try {
        const res = await api.del(`/users/${id}`);
        showToast(res.message || 'Member removed');
        renderTeam();
      } catch (err) {
        showToast(err.message, 'error');
      }
    },
    'Remove Team Member'
  );
}

// ═══════════════════════════════════════════════════════════════
// SETTINGS VIEW (Admin)
// ═══════════════════════════════════════════════════════════════
async function renderSettings() {
  const [taskTypes, roles] = await Promise.all([api.get('/task-types'), api.get('/roles')]);
  state.taskTypes = taskTypes;
  state.roles = roles;

  let html = `
    <div class="page-header">
      <div class="page-header-left"><h2>Settings</h2><p>Manage roles, task types & capacities</p></div>
    </div>

    <!-- Roles Section -->
    <div class="settings-section">
      <div class="settings-section-header">
        <h3><i class="fas fa-id-badge" style="color:var(--primary);margin-right:6px"></i> Roles</h3>
        <button class="btn btn-outline btn-sm" onclick="showAddRoleModal()"><i class="fas fa-plus"></i> Add Role</button>
      </div>
      <table class="settings-table">
        <thead><tr><th>Role Name</th><th>Members</th><th>Task Types</th><th style="width:80px">Actions</th></tr></thead>
        <tbody>`;

  for (const r of roles) {
    html += `<tr>
      <td><strong>${escHtml(r.name)}</strong></td>
      <td>${r.member_count}</td>
      <td>${r.task_type_count}</td>
      <td>
        <button class="btn-icon" title="Delete" onclick="deleteRole(${r.id},'${escHtml(r.name.replace(/'/g,"\\'"))}')">
          <i class="fas fa-trash text-danger"></i>
        </button>
      </td>
    </tr>`;
  }
  html += `</tbody></table></div>

    <!-- Task Types Section -->
    <div class="settings-section">
      <div class="settings-section-header">
        <h3><i class="fas fa-tags" style="color:var(--primary);margin-right:6px"></i> Task Types & Daily Capacities</h3>
        <button class="btn btn-outline btn-sm" onclick="showAddTaskTypeModal()"><i class="fas fa-plus"></i> Add Type</button>
      </div>
      <table class="settings-table">
        <thead><tr><th>Task Type</th><th>Role</th><th>Daily Capacity</th><th>Tasks Used</th><th>Kind</th><th style="width:100px">Actions</th></tr></thead>
        <tbody>`;

  for (const tt of taskTypes) {
    html += `<tr>
      <td><strong>${escHtml(tt.name)}</strong></td>
      <td>${escHtml(tt.role_name||'—')}</td>
      <td>
        <div class="flex-center">
          <input type="number" min="1" max="50" value="${tt.daily_capacity}"
            style="width:60px;padding:4px 8px;border:1px solid var(--border);border-radius:6px;font-size:13px"
            onchange="updateCapacity(${tt.id}, this.value)" />
          <span class="text-muted text-sm">/ day</span>
        </div>
      </td>
      <td>${tt.task_count}</td>
      <td>${tt.is_predefined ? '<span class="badge-predefined">Predefined</span>' : '<span class="badge-custom">Custom</span>'}</td>
      <td>
        <div class="flex-center">
          <button class="btn-icon" title="Edit" onclick="showEditTaskTypeModal(${tt.id})"><i class="fas fa-pen text-muted"></i></button>
          <button class="btn-icon" title="Delete" onclick="deleteTaskType(${tt.id},'${escHtml(tt.name.replace(/'/g,"\\'"))}')"><i class="fas fa-trash text-danger"></i></button>
        </div>
      </td>
    </tr>`;
  }
  html += `</tbody></table></div>`;

  document.getElementById('view-container').innerHTML = html;
}

async function showAddRoleModal() {
  const html = `
    <form>
      <div class="form-group">
        <label>Role Name <span class="required">*</span></label>
        <input type="text" name="name" placeholder="e.g. Motion Designer" required />
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary">Add Role</button>
      </div>
    </form>`;
  showModal('Add Role', html, async (fd) => {
    await api.post('/roles', { name: fd.get('name') });
    showToast('Role added');
    renderSettings();
  });
}

async function deleteRole(id, name) {
  showConfirm(
    `Delete role "${name}"? This only works if no members or task types use it.`,
    async () => {
      try { await api.del(`/roles/${id}`); showToast('Role deleted'); renderSettings(); }
      catch (e) { showToast(e.message, 'error'); }
    },
    'Delete Role'
  );
}

async function showAddTaskTypeModal() {
  if (state.roles.length === 0) state.roles = await api.get('/roles');
  const roleOpts = state.roles.map(r => `<option value="${r.id}">${escHtml(r.name)}</option>`).join('');

  const html = `
    <form>
      <div class="form-row">
        <div class="form-group">
          <label>Type Name <span class="required">*</span></label>
          <input type="text" name="name" placeholder="e.g. Podcast Edit" required />
        </div>
        <div class="form-group">
          <label>Assigned Role <span class="required">*</span></label>
          <select name="role_id" required>
            <option value="">Select role…</option>
            ${roleOpts}
          </select>
        </div>
      </div>
      <div class="form-group">
        <label>Daily Capacity (tasks per person per day)</label>
        <input type="number" name="daily_capacity" value="2" min="1" max="50" />
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary">Add Task Type</button>
      </div>
    </form>`;

  showModal('Add Task Type', html, async (fd) => {
    await api.post('/task-types', {
      name: fd.get('name'),
      role_id: parseInt(fd.get('role_id')),
      daily_capacity: parseInt(fd.get('daily_capacity')) || 2,
    });
    showToast('Task type added');
    renderSettings();
  });
}

async function showEditTaskTypeModal(id) {
  if (state.roles.length === 0) state.roles = await api.get('/roles');
  const tt = state.taskTypes.find(t => t.id === id);
  if (!tt) return;

  const roleOpts = state.roles.map(r =>
    `<option value="${r.id}" ${r.id===tt.role_id?'selected':''}>${escHtml(r.name)}</option>`
  ).join('');

  const html = `
    <form>
      <div class="form-row">
        <div class="form-group">
          <label>Type Name</label>
          <input type="text" name="name" value="${escHtml(tt.name)}" required />
        </div>
        <div class="form-group">
          <label>Role</label>
          <select name="role_id">${roleOpts}</select>
        </div>
      </div>
      <div class="form-group">
        <label>Daily Capacity</label>
        <input type="number" name="daily_capacity" value="${tt.daily_capacity}" min="1" max="50" />
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary">Save</button>
      </div>
    </form>`;

  showModal(`Edit — ${tt.name}`, html, async (fd) => {
    await api.put(`/task-types/${id}`, {
      name: fd.get('name'),
      role_id: parseInt(fd.get('role_id')),
      daily_capacity: parseInt(fd.get('daily_capacity')),
    });
    showToast('Task type updated');
    renderSettings();
  });
}

async function updateCapacity(id, value) {
  try {
    await api.put(`/task-types/${id}`, { daily_capacity: parseInt(value) });
    showToast('Capacity updated');
    // Update local state too
    const tt = state.taskTypes.find(t => t.id === id);
    if (tt) tt.daily_capacity = parseInt(value);
  } catch (e) {
    showToast(e.message, 'error');
  }
}

async function deleteTaskType(id, name) {
  showConfirm(
    `Delete task type "${name}"? Only possible if no tasks use it.`,
    async () => {
      try { await api.del(`/task-types/${id}`); showToast('Task type deleted'); renderSettings(); }
      catch (e) { showToast(e.message, 'error'); }
    },
    'Delete Task Type'
  );
}

// ═══════════════════════════════════════════════════════════════
// AUTH
// ═══════════════════════════════════════════════════════════════
async function login(email, password) {
  const data = await api.post('/auth/login', { email, password });
  state.token = data.token;
  state.user  = data.user;
  localStorage.setItem('tf_token', data.token);
  return data;
}

async function logout() {
  // Stop any running task timer via API before clearing state
  if (state.activeTimer) {
    try { await api.post(`/tasks/${state.activeTimer.task_id}/timer/stop`, {}); } catch(_) {}
  }
  clearInterval(state.punchInterval);
  clearInterval(state.timerInterval);
  clearInterval(state.dashboardRefreshInterval);
  state.punchInterval           = null;
  state.timerInterval           = null;
  state.dashboardRefreshInterval = null;
  state.activeTimer             = null;
  state.token                   = null;
  state.user                    = null;
  state.roles                   = [];
  state.taskTypes               = [];
  state.users                   = [];
  localStorage.removeItem('tf_token');
  document.getElementById('app').style.display = 'none';
  document.getElementById('login-screen').style.display = 'flex';
  showToast('Signed out successfully');
}

function setupApp(user) {
  state.user = user;
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app').style.display = 'flex';

  // Update sidebar user info
  document.getElementById('sidebar-name').textContent = user.name;
  document.getElementById('sidebar-role').textContent = user.is_admin ? 'Administrator' : (user.role_name || 'Team Member');
  document.getElementById('sidebar-avatar').textContent = getInitials(user.name);
  document.getElementById('sidebar-avatar').style.background = getAvatarColor(user.id);

  // Show/hide admin-only nav items
  document.querySelectorAll('.admin-only').forEach(el => {
    el.style.display = user.is_admin ? 'flex' : 'none';
  });

  renderView();
}

// ═══════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════
function emptyState(title, msg, icon = 'fa-inbox') {
  return `<div class="empty-state">
    <div class="empty-icon"><i class="fas ${icon}"></i></div>
    <h3>${escHtml(title)}</h3>
    <p>${escHtml(msg)}</p>
  </div>`;
}

async function init() {
  // Wire up login form
  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('login-btn');
    const errEl = document.getElementById('login-error');
    errEl.style.display = 'none';
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner" style="animation:spin .7s linear infinite"></i> Signing in…';

    try {
      const email    = document.getElementById('login-email').value;
      const password = document.getElementById('login-password').value;
      const data = await login(email, password);
      setupApp(data.user);
    } catch (err) {
      errEl.style.display = 'flex';
      errEl.innerHTML = `<i class="fas fa-circle-xmark"></i> ${escHtml(err.message)}`;
      btn.disabled = false;
      btn.innerHTML = '<span>Sign In</span><i class="fas fa-arrow-right"></i>';
    }
  });

  // Wire up sidebar nav
  document.querySelectorAll('.nav-item[data-view]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      navigate(el.dataset.view);
    });
  });

  // Auto-login if token exists
  if (state.token) {
    try {
      const user = await api.get('/auth/me');
      setupApp(user);
    } catch {
      localStorage.removeItem('tf_token');
      state.token = null;
    }
  }
}

document.addEventListener('DOMContentLoaded', init);
