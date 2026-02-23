require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// API Routes
app.use('/api/auth',        require('./routes/auth'));
app.use('/api/users',       require('./routes/users'));
app.use('/api/tasks',       require('./routes/tasks'));
app.use('/api/task-types',  require('./routes/taskTypes'));
app.use('/api/roles',       require('./routes/roles'));
app.use('/api/dashboard',   require('./routes/dashboard'));
app.use('/api/time-logs',   require('./routes/timeLogs'));
app.use('/api/performance', require('./routes/performance'));

// Serve frontend SPA for all non-API routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Start: initialize DB (async with sql.js), then listen ─────
const { initDatabase } = require('./database/db');

initDatabase()
  .then(() => {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
      console.log(`\n🚀 TaskFlow Agency Manager running on http://localhost:${PORT}`);
      console.log(`📧 Default Admin Login:`);
      console.log(`   Email:    admin@agency.com`);
      console.log(`   Password: Admin@1234\n`);
    });
  })
  .catch((err) => {
    console.error('❌ Failed to initialize database:', err);
    process.exit(1);
  });
