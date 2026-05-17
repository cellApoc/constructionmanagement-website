/**
 * @file Reporting routes for job progress, production rates, dashboard KPIs,
 * and worker-specific dashboard data. Provides aggregated data for the Reports
 * page, admin Dashboard, and personalized Worker Dashboard. The worker-dashboard
 * endpoint returns assigned tasks, hours, rejections, and upcoming deadlines.
 * All routes require authentication.
 * @module server/routes/reports
 */

const express = require('express');
const db = require('../db');
const { auth } = require('../middleware/auth');

const router = express.Router();

router.use(auth);

/**
 * GET /api/reports/job/:jobId/progress
 * Retrieve a detailed progress report for a job with hierarchical breakdown:
 * scopes -> activities -> tasks. Includes percent complete at each level,
 * estimated vs actual hours, and overall totals.
 * @param {string} req.params.jobId - Job UUID
 * @returns {Object} 200 - { job: { id, name, budget, status }, overallPercentComplete, totalEstimatedHours, totalActualHours, scopes: [...] }
 * @returns {Object} 404 - { error: 'Job not found' }
 */
router.get('/job/:jobId/progress', async (req, res) => {
  try {
    const job = (await db.query(`SELECT * FROM jobs WHERE id = $1`, [req.params.jobId])).rows[0];
    if (!job) return res.status(404).json({ error: 'Job not found' });

    const scopes = (await db.query(`SELECT * FROM scopes WHERE jobId = $1 ORDER BY sortOrder`, [req.params.jobId])).rows;

    const scopeProgress = scopes.map(scope => {
      const activities = (await db.query(`SELECT * FROM activities WHERE scopeId = $1 ORDER BY sortOrder`, [scope.id])).rows;

      const activityProgress = activities.map(activity => {
        const tasks = (await db.query(`SELECT * FROM tasks WHERE activityId = $1 ORDER BY sortOrder`, [activity.id])).rows;

        const taskProgress = tasks.map(t => ({
          id: t.id,
          name: t.name,
          percentComplete: t.currentPercentComplete,
          scheduledStartDate: t.scheduledStartDate,
          scheduledFinishDate: t.scheduledFinishDate
        }));

        // When tasks exist, average their %; otherwise use activity's own percentComplete
        const activityPercent = tasks.length > 0
          ? tasks.reduce((sum, t) => sum + t.currentPercentComplete, 0) / tasks.length
          : (activity.percentComplete || 0);

        const laborHours = (await db.query(`
          SELECT COALESCE(SUM(hours), 0) as total FROM timesheet_entries
          WHERE activityId = $1 AND status = 'approved'
        `, [activity.id])).rows[0];

        return {
          id: activity.id,
          name: activity.name,
          percentComplete: Math.round(activityPercent * 100) / 100,
          estimatedHours: activity.estimatedHours || 0,
          actualHours: laborHours.total,
          tasks: taskProgress
        };
      });

      const scopePercent = activityProgress.length > 0
        ? activityProgress.reduce((sum, a) => sum + a.percentComplete, 0) / activityProgress.length
        : 0;

      const scopeEstimatedHours = activityProgress.reduce((sum, a) => sum + (a.estimatedHours || 0), 0);
      const scopeActualHours = activityProgress.reduce((sum, a) => sum + (a.actualHours || 0), 0);

      return {
        id: scope.id,
        name: scope.name,
        percentComplete: Math.round(scopePercent * 100) / 100,
        estimatedValue: scope.estimatedValue,
        estimatedHours: scopeEstimatedHours,
        actualHours: scopeActualHours,
        activities: activityProgress
      };
    });

    const overallPercent = scopeProgress.length > 0
      ? scopeProgress.reduce((sum, s) => sum + s.percentComplete, 0) / scopeProgress.length
      : 0;

    const totalEstimatedHours = scopeProgress.reduce((sum, s) =>
      sum + s.activities.reduce((aSum, a) => aSum + a.estimatedHours, 0), 0);
    const totalActualHours = scopeProgress.reduce((sum, s) =>
      sum + s.activities.reduce((aSum, a) => aSum + a.actualHours, 0), 0);

    res.json({
      job: { id: job.id, name: job.name, budget: job.budget, status: job.status },
      overallPercentComplete: Math.round(overallPercent * 100) / 100,
      totalEstimatedHours,
      totalActualHours,
      scopes: scopeProgress
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/reports/production-rates
 * Retrieve production rate metrics grouped by activity name. Includes task count,
 * average completion percentage, total approved labor hours, and tasks completed per hour.
 * @returns {Object[]} 200 - Array of { activityName, taskCount, avgCompletion, totalLaborHours, tasksCompletedPerHour }
 */
router.get('/production-rates', async (req, res) => {
  try {
    const rates = (await db.query(`
      SELECT a.name as activityName,
        COUNT(DISTINCT t.id) as taskCount,
        AVG(t.currentPercentComplete) as avgCompletion,
        COALESCE(SUM(te.hours), 0) as totalLaborHours,
        CASE WHEN COALESCE(SUM(te.hours), 0) > 0
          THEN COUNT(DISTINCT CASE WHEN t.currentPercentComplete >= 100 THEN t.id END) * 1.0 / SUM(te.hours)
          ELSE 0
        END as tasksCompletedPerHour
      FROM activities a
      JOIN tasks t ON t.activityId = a.id
      LEFT JOIN timesheet_entries te ON te.activityId = a.id AND te.status = 'approved'
      GROUP BY a.name
      ORDER BY a.name
    `)).rows;

    res.json(rates);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/reports/dashboard
 * Retrieve dashboard KPI metrics: active job count, average task completion,
 * labor hours this week, pending approvals (daily updates + timesheets),
 * top delayed tasks, and recent approved activity.
 * @returns {Object} 200 - { totalActiveJobs, averageCompletion, totalLaborHoursThisWeek, pendingApprovals, topDelayedTasks, recentActivity }
 */
router.get('/dashboard', async (req, res) => {
  try {
    const totalActiveJobs = (await db.query(`SELECT COUNT(*) as count FROM jobs WHERE status = 'active'`)).rows[0].count;

    const avgCompletion = (await db.query(`
      SELECT AVG(t.currentPercentComplete) as avg
      FROM tasks t
      JOIN activities a ON t.activityId = a.id
      JOIN scopes s ON a.scopeId = s.id
      JOIN jobs j ON s.jobId = j.id
      WHERE j.status = 'active'
    `)).rows[0];

    const today = new Date();
    const dayOfWeek = today.getDay();
    const mondayOffset = dayOfWeek === 0 $1 6 : dayOfWeek - 1;
    const monday = new Date(today);
    monday.setDate(today.getDate() - mondayOffset);
    const weekStart = monday.toISOString().split('T')[0];
    const weekEnd = new Date(monday);
    weekEnd.setDate(monday.getDate() + 6);
    const weekEndStr = weekEnd.toISOString().split('T')[0];

    const totalLaborHoursThisWeek = (await db.query(`
      SELECT COALESCE(SUM(hours), 0) as total FROM timesheet_entries
      WHERE date >= $1 AND date <= $2
    `, [weekStart, weekEndStr])).rows[0];

    const pendingUpdates = (await db.query(`SELECT COUNT(*) as count FROM daily_task_updates WHERE status = 'pending'`)).rows[0].count;
    const pendingTimesheets = (await db.query(`SELECT COUNT(*) as count FROM timesheet_entries WHERE status = 'pending'`)).rows[0].count;
    const pendingApprovals = pendingUpdates + pendingTimesheets;

    const recentActivity = (await db.query(`
      SELECT dtu.id, dtu.date, dtu.percentComplete, dtu.approvedAt,
        t.name as taskName, j.name as jobName, u.name as userName
      FROM daily_task_updates dtu
      JOIN tasks t ON dtu.taskId = t.id
      JOIN activities a ON t.activityId = a.id
      JOIN scopes s ON a.scopeId = s.id
      JOIN jobs j ON s.jobId = j.id
      LEFT JOIN users u ON dtu.workerId = u.id
      WHERE dtu.status = 'approved'
      ORDER BY dtu.approvedAt DESC
      LIMIT 5
    `)).rows;

    const delayedTasks = (await db.query(`
      SELECT t.id, t.name as taskName, t.scheduledFinishDate, t.currentPercentComplete,
        a.name as activityName, s.name as scopeName, j.name as jobName, j.id as jobId
      FROM tasks t
      JOIN activities a ON t.activityId = a.id
      JOIN scopes s ON a.scopeId = s.id
      JOIN jobs j ON s.jobId = j.id
      WHERE j.status = 'active'
        AND t.scheduledFinishDate IS NOT NULL
        AND t.scheduledFinishDate < date('now')
        AND t.currentPercentComplete < 100
      ORDER BY t.scheduledFinishDate ASC
      LIMIT 10
    `)).rows;

    res.json({
      totalActiveJobs,
      averageCompletion: Math.round((avgCompletion.avg || 0) * 100) / 100,
      totalLaborHoursThisWeek: totalLaborHoursThisWeek.total,
      pendingApprovals,
      topDelayedTasks: delayedTasks,
      recentActivity
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/reports/worker-dashboard
 * Retrieve worker-specific dashboard data: assigned tasks, rejected items needing attention,
 * hours this week, and upcoming tasks.
 * @returns {Object} 200 - { totalAssigned, completedTasks, overdueTasks, hoursThisWeek, rejectedItems, upcomingTasks }
 */
router.get('/worker-dashboard', async (req, res) => {
  try {
    const userId = req.user.id;

    // Tasks assigned to this worker (via worker_assignments)
    const assignedTasks = (await db.query(`
      SELECT t.*, a.name as activityName, s.name as scopeName,
             j.id as jobId, j.name as jobName
      FROM tasks t
      JOIN activities a ON t.activityId = a.id
      JOIN scopes s ON a.scopeId = s.id
      JOIN jobs j ON s.jobId = j.id
      JOIN worker_assignments wa ON wa.activityId = a.id AND wa.workerId = $1
      WHERE j.status = 'active'
      ORDER BY t.scheduledFinishDate ASC
    `, [userId])).rows;

    const totalAssigned = assignedTasks.length;
    const completedTasks = assignedTasks.filter(t => t.currentPercentComplete >= 100).length;
    const today = new Date().toISOString().split('T')[0];
    const overdueTasks = assignedTasks.filter(t =>
      t.scheduledFinishDate && t.scheduledFinishDate < today && t.currentPercentComplete < 100
    ).length;

    // Hours this week
    const dayOfWeek = new Date().getDay();
    const mondayOffset = dayOfWeek === 0 $2 6 : dayOfWeek - 1;
    const monday = new Date();
    monday.setDate(monday.getDate() - mondayOffset);
    const weekStart = monday.toISOString().split('T')[0];
    const weekEnd = new Date(monday);
    weekEnd.setDate(monday.getDate() + 6);
    const weekEndStr = weekEnd.toISOString().split('T')[0];

    const hoursThisWeek = (await db.query(`
      SELECT COALESCE(SUM(hours), 0) as total FROM timesheet_entries
      WHERE workerId = $3 AND date >= $4 AND date <= $5 AND status = 'approved'
    `, [userId, weekStart, weekEndStr])).rows[0].total;

    const pendingHours = (await db.query(`
      SELECT COALESCE(SUM(hours), 0) as total FROM timesheet_entries
      WHERE workerId = $1 AND date >= $2 AND date <= $3 AND status = 'pending'
    `, [userId, weekStart, weekEndStr])).rows[0].total;

    // Recent rejections needing attention
    const rejectedUpdates = (await db.query(`
      SELECT dtu.id, dtu.rejectionNote, dtu.rejectedAt, t.name as taskName, j.name as jobName,
        u.name as rejectorName, 'daily_update' as type
      FROM daily_task_updates dtu
      JOIN tasks t ON dtu.taskId = t.id
      JOIN activities a ON t.activityId = a.id
      JOIN scopes s ON a.scopeId = s.id
      JOIN jobs j ON s.jobId = j.id
      LEFT JOIN users u ON dtu.rejectedById = u.id
      WHERE dtu.workerId = $1 AND dtu.status = 'rejected'
      ORDER BY dtu.rejectedAt DESC LIMIT 5
    `, [userId])).rows;

    const rejectedTimesheets = (await db.query(`
      SELECT te.id, te.rejectionNote, te.rejectedAt, a.name as activityName, j.name as jobName,
        te.hours, u.name as rejectorName, 'timesheet' as type
      FROM timesheet_entries te
      JOIN activities a ON te.activityId = a.id
      JOIN scopes s ON a.scopeId = s.id
      JOIN jobs j ON s.jobId = j.id
      LEFT JOIN users u ON te.rejectedById = u.id
      WHERE te.workerId = $2 AND te.status = 'rejected'
      ORDER BY te.rejectedAt DESC LIMIT 5
    `, [userId])).rows;

    // Upcoming tasks (next 7 days)
    const nextWeek = new Date();
    nextWeek.setDate(nextWeek.getDate() + 7);
    const nextWeekStr = nextWeek.toISOString().split('T')[0];

    const upcomingTasks = assignedTasks
      .filter(t => t.scheduledFinishDate && t.scheduledFinishDate >= today && t.scheduledFinishDate <= nextWeekStr && t.currentPercentComplete < 100)
      .slice(0, 5);

    res.json({
      totalAssigned,
      completedTasks,
      overdueTasks,
      hoursThisWeek: Math.round(hoursThisWeek * 100) / 100,
      pendingHours: Math.round(pendingHours * 100) / 100,
      rejectedItems: [...rejectedUpdates, ...rejectedTimesheets].sort((a, b) =>
        (b.rejectedAt || '').localeCompare(a.rejectedAt || '')
      ).slice(0, 5),
      upcomingTasks,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/reports/charts — aggregated chart data for dashboard
router.get('/charts', async (req, res) => {
  try {
    // 1. Job completion chart — all active jobs with % complete
    const jobCompletion = (await db.query(`
      SELECT j.id, j.name, j.budget FROM jobs j WHERE j.status = 'active' ORDER BY j.name
    `)).rows.map(job => {
      const tasks = (await db.query(`
        SELECT t.currentPercentComplete FROM tasks t
        JOIN activities a ON t.activityId = a.id
        JOIN scopes s ON a.scopeId = s.id
        WHERE s.jobId = $3
      `, [job.id])).rows;
      const pct = tasks.length > 0
        $4 tasks.reduce((s, t) => s + t.currentPercentComplete, 0) / tasks.length
        : 0;
      return { id: job.id, name: job.name, budget: job.budget, percentComplete: Math.round(pct * 10) / 10 };
    });

    // 2. Weekly labor hours — last 8 weeks
    const weeks = [];
    const now = new Date();
    for (let i = 7; i >= 0; i--) {
      const weekStart = new Date(now);
      const dayOfWeek = weekStart.getDay();
      weekStart.setDate(weekStart.getDate() - (dayOfWeek === 0 $5 6 : dayOfWeek - 1) - (i * 7));
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 6);
      const startStr = weekStart.toISOString().split('T')[0];
      const endStr = weekEnd.toISOString().split('T')[0];
      const label = weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

      const approved = (await db.query(`
        SELECT COALESCE(SUM(hours), 0) as total FROM timesheet_entries
        WHERE date >= $6 AND date <= $7 AND status = 'approved'
      `, [startStr, endStr])).rows[0].total;

      const pending = (await db.query(`
        SELECT COALESCE(SUM(hours), 0) as total FROM timesheet_entries
        WHERE date >= $1 AND date <= $2 AND status = 'pending'
      `, [startStr, endStr])).rows[0].total;

      weeks.push({ label, startDate: startStr, approved: Math.round(approved * 10) / 10, pending: Math.round(pending * 10) / 10 });
    }

    // 3. Budget utilization — active jobs with budgets
    const budgetUtil = jobCompletion.filter(j => j.budget > 0).map(job => {
      const actual = (await db.query(`
        SELECT COALESCE(SUM(bi.actualAmount), 0) as total FROM budget_items bi WHERE bi.jobId = $1
      `, [job.id])).rows[0].total;
      return { id: job.id, name: job.name, budget: job.budget, spent: actual };
    });

    res.json({ jobCompletion, weeklyLabor: weeks, budgetUtilization: budgetUtil });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
