/**
 * @file Express server entry point for the Construction Management API.
 * Configures middleware, mounts route handlers (auth, jobs, scopes, activities,
 * tasks, daily updates, timesheets, reports, users, templates, search,
 * notifications, crews, schedule, settings),
 * initializes the database, and starts listening on the configured port.
 * @module server/index
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
// Database managed externally (01_postgres_schema.sql)

const authRoutes = require('./routes/auth');
const jobsRoutes = require('./routes/jobs');
const scopesRoutes = require('./routes/scopes');
const activitiesRoutes = require('./routes/activities');
const tasksRoutes = require('./routes/tasks');
const dailyUpdatesRoutes = require('./routes/dailyUpdates');
const timesheetsRoutes = require('./routes/timesheets');
const reportsRoutes = require('./routes/reports');
const usersRoutes = require('./routes/users');
const templatesRoutes = require('./routes/templates');
const searchRoutes = require('./routes/search');
const notificationsRoutes = require('./routes/notifications');
const crewsRoutes = require('./routes/crews');
const scheduleRoutes = require('./routes/schedule');
const settingsRoutes = require('./routes/settings');
const budgetRoutes = require('./routes/budget');
const laborRatesRoutes = require('./routes/laborRates');
const alertRulesRoutes = require('./routes/alertRules');
const jobEventsRoutes = require('./routes/jobEvents');

/** @type {import('express').Application} */
const app = express();

/** @type {number} Server port, defaults to 3001 */
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Route mounting
app.use('/api/auth', authRoutes);
app.use('/api/jobs', jobsRoutes);
app.use('/api/scopes', scopesRoutes);
app.use('/api/activities', activitiesRoutes);
app.use('/api/tasks', tasksRoutes);
app.use('/api/daily-updates', dailyUpdatesRoutes);
app.use('/api/timesheets', timesheetsRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/templates', templatesRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/crews', crewsRoutes);
app.use('/api/schedule', scheduleRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/budget', budgetRoutes);
app.use('/api/labor-rates', laborRatesRoutes);
app.use('/api/alert-rules', alertRulesRoutes);
app.use('/api/job-events', jobEventsRoutes);

// Database tables created via 01_postgres_schema.sql
// No initialize() needed — schema is managed externally

// Serve built frontend
const publicDir = path.join(__dirname, 'public');
if (require('fs').existsSync(publicDir)) {
  app.use(express.static(publicDir));
  app.get('*', async (req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
