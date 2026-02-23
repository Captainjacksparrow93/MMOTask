const express = require('express');
const router = express.Router();
const { getDb } = require('../database/db');
const { authenticate, adminOnly } = require('../middleware/auth');

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

module.exports = router;