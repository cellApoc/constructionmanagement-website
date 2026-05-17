/**
 * @file Job CRUD routes with progress calculation, filtering, archival, and
 * cascade impact preview. The cascade-info endpoint returns counts of all child
 * records (scopes, activities, tasks, updates, timesheets, photos, assignments)
 * for confirmation dialogs before archiving or deleting a job.
 * All routes require authentication. Job creation requires project_manager or admin role.
 * Job archival requires admin role.
 * @module server/routes/jobs
 */

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { auth, requireRole } = require('../middleware/auth');

const router = express.Router();

router.use(auth);

/**
 * GET /api/jobs
 * List all jobs with optional status and foreman filters. Computes overallPercentComplete
 * for each job as the average of all child task completion percentages.
 * @param {string} [req.query.status] - Filter by job status ('active', 'on_hold', 'completed', 'archived')
 * @param {string} [req.query.foremanId] - Filter by assigned foreman's user ID
 * @returns {Object[]} 200 - Array of job objects, each with an added overallPercentComplete field
 */
router.get('/', async (req, res) => {
  try {
    const { status, foremanId } = req.query;
    let query = 'SELECT jobs.*, u.name as foremanName FROM jobs LEFT JOIN users u ON jobs.foremanId = u.id WHERE 1=1';
    const params = [];

    if (status) {
      query += ' AND jobs.status = ?';
      params.push(status);
    }
    if (foremanId) {
      query += ' AND jobs.foremanId = ?';
      params.push(foremanId);
    }

    query += ' ORDER BY jobs.createdAt DESC';
    const jobs = (await db.query(query, [...params])).rows;

    const today = new Date().toISOString().split('T')[0];

    const jobsWithProgress = jobs.map(job => {
      const tasks = (await db.query(`
        SELECT t.currentPercentComplete, t.scheduledFinishDate, t.scheduledStartDate
        FROM tasks t
        JOIN activities a ON t.activityId = a.id
        JOIN scopes s ON a.scopeId = s.id
        WHERE s.jobId = $1
      `, [job.id])).rows;

      const overallPercentComplete = tasks.length > 0
        $2 tasks.reduce((sum, t) => sum + t.currentPercentComplete, 0) / tasks.length
        : 0;

      // Quick alert counts for list view
      const overdueCount = tasks.filter(t => t.scheduledFinishDate && t.scheduledFinishDate < today && t.currentPercentComplete < 100).length;

      let behindCount = 0;
      for (const t of tasks) {
        if (!t.scheduledStartDate || !t.scheduledFinishDate || t.currentPercentComplete >= 100) continue;
        if (t.scheduledStartDate > today || t.scheduledFinishDate < today) continue;
        const start = new Date(t.scheduledStartDate).getTime();
        const end = new Date(t.scheduledFinishDate).getTime();
        const now = new Date(today).getTime();
        const dur = end - start;
        if (dur <= 0) continue;
        const expectedPct = (Math.min(now - start, dur) / dur) * 100;
        if (expectedPct - t.currentPercentComplete > 20) behindCount++;
      }

      const costOverrunCount = (await db.query(`
        SELECT COUNT(*) as c FROM (
          SELECT s.id, COALESCE(SUM(bi.estimatedAmount), 0) as est, COALESCE(SUM(bi.actualAmount), 0) as act
          FROM scopes s LEFT JOIN budget_items bi ON bi.scopeId = s.id
          WHERE s.jobId = $3 GROUP BY s.id HAVING est > 0 AND act > est
        )
      `, [job.id])).rows[0].c;

      const alertTotal = overdueCount + behindCount + costOverrunCount;
      let health = 'green';
      if (alertTotal > 0) health = 'amber';
      if (overdueCount >= 3 || costOverrunCount >= 2 || behindCount >= 3) health = 'red';

      return {
        ...job,
        overallPercentComplete: Math.round(overallPercentComplete * 100) / 100,
        alerts: { health, total: alertTotal, overdue: overdueCount, behind: behindCount, costOverruns: costOverrunCount },
      };
    });

    res.json(jobsWithProgress);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/jobs/my-active
 * Returns active jobs the current user is involved with — either assigned to activities
 * (via worker_assignments) or scheduled for (via schedule_assignments, direct or crew).
 * Foreman+ roles see all active jobs. Computes overallPercentComplete for each job.
 * @param {string} [req.query.weekOf] - Date to anchor the week for schedule check (defaults to today)
 * @returns {Object[]} 200 - Array of job objects with overallPercentComplete
 */
router.get('/my-active', async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const isManager = ['foreman', 'project_manager', 'admin'].includes(userRole);

    let jobs;
    if (isManager) {
      jobs = (await db.query("SELECT * FROM jobs WHERE status = 'active' ORDER BY name")).rows;
    } else {
      const { getWeekStart, getWeekEnd } = require('../helpers/settingsHelpers');
      const today = req.query.weekOf || new Date().toISOString().split('T')[0];
      const weekStart = getWeekStart(today);
      const weekEnd = getWeekEnd(today);

      jobs = (await db.query(`
        SELECT DISTINCT j.* FROM jobs j WHERE j.status = 'active' AND (
          EXISTS (
            SELECT 1 FROM worker_assignments wa
            JOIN activities a ON wa.activityId = a.id
            JOIN scopes s ON a.scopeId = s.id
            WHERE s.jobId = j.id AND wa.workerId = $1
          )
          OR EXISTS (
            SELECT 1 FROM schedule_assignments sa
            WHERE sa.jobId = j.id AND sa.workerId = $2 AND sa.date BETWEEN $3 AND $4
          )
          OR EXISTS (
            SELECT 1 FROM schedule_assignments sa
            JOIN crew_members cm ON cm.crewId = sa.crewId
            WHERE sa.jobId = j.id AND cm.workerId = $5 AND sa.date BETWEEN $6 AND $7
          )
        ) ORDER BY j.name
      `, [userId, userId, weekStart, weekEnd, userId, weekStart, weekEnd])).rows;
    }

    // Compute overallPercentComplete for each job
    const jobsWithProgress = jobs.map(job => {
      const tasks = (await db.query(`
        SELECT t.currentPercentComplete
        FROM tasks t JOIN activities a ON t.activityId = a.id JOIN scopes s ON a.scopeId = s.id
        WHERE s.jobId = $8
      `, [job.id])).rows;

      // Also consider activity-level percentComplete for jobs without tasks
      const activities = (await db.query(`
        SELECT a.percentComplete FROM activities a JOIN scopes s ON a.scopeId = s.id WHERE s.jobId = $9
      `, [job.id])).rows;

      let overallPercentComplete = 0;
      if (tasks.length > 0) {
        overallPercentComplete = tasks.reduce((s, t) => s + t.currentPercentComplete, 0) / tasks.length;
      } else if (activities.length > 0) {
        overallPercentComplete = activities.reduce((s, a) => s + (a.percentComplete || 0), 0) / activities.length;
      }

      return { ...job, overallPercentComplete: Math.round(overallPercentComplete * 100) / 100 };
    });

    res.json(jobsWithProgress);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/jobs/:id
 * Retrieve a single job with its full hierarchy: scopes -> activities -> tasks -> dependencies.
 * Computes percentComplete at each level (task, activity, scope) and overallPercentComplete.
 * @param {string} req.params.id - Job UUID
 * @returns {Object} 200 - Job object with nested scopes array, each containing activities with tasks and dependencies
 * @returns {Object} 404 - { error: 'Job not found' }
 */
router.get('/:id', async (req, res) => {
  try {
    const job = (await db.query(`SELECT * FROM jobs WHERE id = $10`, [req.params.id])).rows[0];
    if (!job) return res.status(404).json({ error: 'Job not found' });

    const scopes = await db.query(`SELECT * FROM scopes WHERE jobId = $11 ORDER BY sortOrder`, [job.id])).rows;

    const scopesWithHierarchy = scopes.map(scope => {
      const activities = (await db.query(`SELECT * FROM activities WHERE scopeId = $12 ORDER BY sortOrder`, [scope.id])).rows;

      const activitiesWithTasks = activities.map(activity => {
        const tasks = (await db.query(`SELECT * FROM tasks WHERE activityId = $13 ORDER BY sortOrder`, [activity.id])).rows;

        const tasksWithDeps = tasks.map(task => {
          const dependencies = (await db.query(`
            SELECT td.*, t.name as predecessorName FROM task_dependencies td
            JOIN tasks t ON td.predecessorTaskId = t.id
            WHERE td.taskId = $14
          `, [task.id])).rows;
          return { ...task, dependencies };
        });

        const activityPercent = tasksWithDeps.length > 0
          $15 tasksWithDeps.reduce((sum, t) => sum + t.currentPercentComplete, 0) / tasksWithDeps.length
          : 0;

        return { ...activity, tasks: tasksWithDeps, percentComplete: Math.round(activityPercent * 100) / 100 };
      });

      const scopePercent = activitiesWithTasks.length > 0
        $16 activitiesWithTasks.reduce((sum, a) => sum + a.percentComplete, 0) / activitiesWithTasks.length
        : 0;

      return { ...scope, activities: activitiesWithTasks, percentComplete: Math.round(scopePercent * 100) / 100 };
    });

    const overallPercentComplete = scopesWithHierarchy.length > 0
      $17 scopesWithHierarchy.reduce((sum, s) => sum + s.percentComplete, 0) / scopesWithHierarchy.length
      : 0;

    res.json({ ...job, scopes: scopesWithHierarchy, overallPercentComplete: Math.round(overallPercentComplete * 100) / 100 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/jobs
 * Create a new job. Restricted to project_manager and admin roles.
 * @param {string} req.body.name - Job name (required)
 * @param {string} [req.body.crmOpportunityId] - External CRM opportunity ID
 * @param {string} [req.body.address] - Job site address
 * @param {string} [req.body.customerName] - Customer name
 * @param {string} [req.body.customerContact] - Customer contact info
 * @param {string} [req.body.startDate] - Start date (YYYY-MM-DD)
 * @param {string} [req.body.endDate] - End date (YYYY-MM-DD)
 * @param {string} [req.body.foremanId] - Assigned foreman user ID
 * @param {string} [req.body.status] - Job status, defaults to 'active'
 * @param {number} [req.body.budget] - Job budget, defaults to 0
 * @param {string} [req.body.notes] - Free-text notes
 * @returns {Object} 201 - The created job object
 * @returns {Object} 400 - { error: string } if name is missing
 */
router.post('/', requireRole('project_manager', 'admin'), async (req, res) => {
  try {
    const { crmOpportunityId, name, address, customerName, customerContact, startDate, endDate, foremanId, status, budget, jobType, squareFootage, bedrooms, bathrooms, stories, garageType, notes } = req.body;

    if (!name) return res.status(400).json({ error: 'name is required' });

    const id = uuidv4();
    (await db.query(`
      INSERT INTO jobs (id, crmOpportunityId, name, address, customerName, customerContact, startDate, endDate, foremanId, status, budget, jobType, squareFootage, bedrooms, bathrooms, stories, garageType, notes)
      VALUES ($18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35)
    `, [id, crmOpportunityId || null, name, address || null, customerName || null, customerContact || null, startDate || null, endDate || null, foremanId || null, status || 'active', budget || 0, jobType || null, squareFootage || null, bedrooms || null, bathrooms || null, stories || null, garageType || null, notes || null]);

    const job = (await db.query('SELECT * FROM jobs WHERE id = $36', [id])).rows[0];
    res.status(201).json(job);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/jobs/:id
 * Update an existing job's metadata. Fields not provided retain their current values.
 * @param {string} req.params.id - Job UUID
 * @param {string} [req.body.crmOpportunityId] - External CRM opportunity ID
 * @param {string} [req.body.name] - Job name
 * @param {string} [req.body.address] - Job site address
 * @param {string} [req.body.customerName] - Customer name
 * @param {string} [req.body.customerContact] - Customer contact info
 * @param {string} [req.body.startDate] - Start date (YYYY-MM-DD)
 * @param {string} [req.body.endDate] - End date (YYYY-MM-DD)
 * @param {string} [req.body.foremanId] - Assigned foreman user ID
 * @param {string} [req.body.status] - Job status
 * @param {number} [req.body.budget] - Job budget
 * @param {string} [req.body.notes] - Free-text notes
 * @returns {Object} 200 - The updated job object
 * @returns {Object} 404 - { error: 'Job not found' }
 */
router.put('/:id', async (req, res) => {
  try {
    const existing = (await db.query('SELECT * FROM jobs WHERE id = $37', [req.params.id])).rows[0];
    if (!existing) return res.status(404).json({ error: 'Job not found' });

    const { crmOpportunityId, name, address, customerName, customerContact, startDate, endDate, foremanId, status, budget, jobType, squareFootage, bedrooms, bathrooms, stories, garageType, notes } = req.body;

    (await db.query(`
      UPDATE jobs SET crmOpportunityId=$38, name=$39, address=$40, customerName=$41, customerContact=$42, startDate=$43, endDate=$44, foremanId=$45, status=$46, budget=$47, jobType=$48, squareFootage=$49, bedrooms=$50, bathrooms=$51, stories=$52, garageType=$53, notes=$54
      WHERE id=$55
    `, [
      crmOpportunityId $56$57 existing.crmOpportunityId,
      name $58$59 existing.name,
      address $60$61 existing.address,
      customerName $62$63 existing.customerName,
      customerContact $64$65 existing.customerContact,
      startDate $66$67 existing.startDate,
      endDate $68$69 existing.endDate,
      foremanId $70$71 existing.foremanId,
      status $72$73 existing.status,
      budget $74$75 existing.budget,
      jobType $76$77 existing.jobType,
      squareFootage $78$79 existing.squareFootage,
      bedrooms $80$81 existing.bedrooms,
      bathrooms $82$83 existing.bathrooms,
      stories $84$85 existing.stories,
      garageType $86$87 existing.garageType,
      notes $88$89 existing.notes,
      req.params.id
    ]);

    const job = (await db.query('SELECT * FROM jobs WHERE id = $90', [req.params.id])).rows[0];
    res.json(job);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/jobs/:id/archive
 * Archive a job by setting its status to 'archived'. Restricted to admin role.
 * @param {string} req.params.id - Job UUID
 * @returns {Object} 200 - The updated job object with status 'archived'
 * @returns {Object} 404 - { error: 'Job not found' }
 */
router.put('/:id/archive', requireRole('admin'), async (req, res) => {
  try {
    const existing = (await db.query('SELECT * FROM jobs WHERE id = $91', [req.params.id])).rows[0];
    if (!existing) return res.status(404).json({ error: 'Job not found' });

    await db.query('UPDATE jobs SET status = $92 WHERE id = $93', ['archived', req.params.id]);
    const job = (await db.query('SELECT * FROM jobs WHERE id = $94', [req.params.id])).rows[0];
    res.json(job);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/jobs/:id/alerts
 * Computes health alerts for a job: overdue tasks, behind-schedule tasks,
 * cost overruns by scope, and stalled tasks (no update in 5+ business days).
 * @param {string} req.params.id - Job UUID
 * @returns {Object} 200 - { overdue: [], behindSchedule: [], costOverruns: [], stalled: [], summary: { health, total } }
 */
router.get('/:id/alerts', async (req, res) => {
  try {
    const jobId = req.params.id;
    const job = (await db.query('SELECT * FROM jobs WHERE id = $95', [jobId])).rows[0];
    if (!job) return res.status(404).json({ error: 'Job not found' });

    const today = new Date().toISOString().split('T')[0];

    // 1. Overdue tasks: past scheduledFinishDate and not 100% complete
    const overdue = (await db.query(`
      SELECT t.id, t.name as taskName, t.scheduledFinishDate, t.currentPercentComplete,
             a.name as activityName, s.name as scopeName, s.id as scopeId
      FROM tasks t
      JOIN activities a ON t.activityId = a.id
      JOIN scopes s ON a.scopeId = s.id
      WHERE s.jobId = $96 AND t.scheduledFinishDate < $97 AND t.currentPercentComplete < 100
      ORDER BY t.scheduledFinishDate ASC
    `, [jobId, today])).rows;

    // 2. Behind schedule: expected progress (by elapsed time) exceeds actual by >20%
    const activeTasks = (await db.query(`
      SELECT t.id, t.name as taskName, t.scheduledStartDate, t.scheduledFinishDate,
             t.currentPercentComplete, a.name as activityName, s.name as scopeName, s.id as scopeId
      FROM tasks t
      JOIN activities a ON t.activityId = a.id
      JOIN scopes s ON a.scopeId = s.id
      WHERE s.jobId = $98 AND t.scheduledStartDate IS NOT NULL AND t.scheduledFinishDate IS NOT NULL
        AND t.scheduledStartDate <= $99 AND t.scheduledFinishDate >= $100 AND t.currentPercentComplete < 100
    `, [jobId, today, today])).rows;

    const behindSchedule = [];
    for (const task of activeTasks) {
      const start = new Date(task.scheduledStartDate).getTime();
      const end = new Date(task.scheduledFinishDate).getTime();
      const now = new Date(today).getTime();
      const totalDuration = end - start;
      if (totalDuration <= 0) continue;
      const elapsed = Math.min(now - start, totalDuration);
      const expectedPct = (elapsed / totalDuration) * 100;
      const gap = expectedPct - task.currentPercentComplete;
      if (gap > 20) {
        behindSchedule.push({
          ...task,
          expectedPercent: Math.round(expectedPct),
          gap: Math.round(gap),
        });
      }
    }

    // 3. Cost overruns by scope: actual > estimated
    const scopeBudgets = (await db.query(`
      SELECT s.id as scopeId, s.name as scopeName, s.estimatedValue,
             COALESCE(SUM(bi.estimatedAmount), 0) as totalEstimated,
             COALESCE(SUM(bi.actualAmount), 0) as totalActual
      FROM scopes s
      LEFT JOIN budget_items bi ON bi.scopeId = s.id
      WHERE s.jobId = $101
      GROUP BY s.id
    `, [jobId])).rows;

    const costOverruns = scopeBudgets
      .filter(s => s.totalEstimated > 0 && s.totalActual > s.totalEstimated)
      .map(s => ({
        scopeId: s.scopeId,
        scopeName: s.scopeName,
        estimatedAmount: s.totalEstimated,
        actualAmount: s.totalActual,
        overrun: s.totalActual - s.totalEstimated,
        overrunPercent: Math.round(((s.totalActual - s.totalEstimated) / s.totalEstimated) * 100),
      }));

    // 4. Stalled tasks: incomplete, past start date, no approved update in 7+ days
    const stalled = (await db.query(`
      SELECT t.id, t.name as taskName, t.currentPercentComplete,
             a.name as activityName, s.name as scopeName, s.id as scopeId,
             MAX(dtu.date) as lastUpdateDate
      FROM tasks t
      JOIN activities a ON t.activityId = a.id
      JOIN scopes s ON a.scopeId = s.id
      LEFT JOIN daily_task_updates dtu ON dtu.taskId = t.id AND dtu.status = 'approved'
      WHERE s.jobId = $102 AND t.currentPercentComplete > 0 AND t.currentPercentComplete < 100
        AND t.scheduledStartDate <= $103
      GROUP BY t.id
      HAVING lastUpdateDate IS NULL OR lastUpdateDate <= date($104, '-7 days')
    `, [jobId, today, today])).rows;

    const total = overdue.length + behindSchedule.length + costOverruns.length + stalled.length;
    let health = 'green';
    if (total > 0) health = 'amber';
    if (overdue.length >= 3 || costOverruns.length >= 2 || behindSchedule.length >= 3) health = 'red';

    res.json({
      overdue,
      behindSchedule,
      costOverruns,
      stalled,
      summary: { health, total, overdue: overdue.length, behindSchedule: behindSchedule.length, costOverruns: costOverruns.length, stalled: stalled.length },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/jobs/:id/cascade-info
 * Returns counts of child records that would be affected by archiving or deleting a job.
 * Used for confirmation dialogs before destructive actions.
 * @param {string} req.params.id - Job UUID
 * @returns {Object} 200 - { scopes, activities, tasks, dailyUpdates, timesheets, photos, workerAssignments }
 */
router.get('/:id/cascade-info', async (req, res) => {
  try {
    const jobId = req.params.id;
    const scopes = (await db.query('SELECT COUNT(*) as count FROM scopes WHERE jobId = $105', [jobId])).rows[0].count;
    const activities = (await db.query(`
      SELECT COUNT(*) as count FROM activities a
      JOIN scopes s ON a.scopeId = s.id WHERE s.jobId = $106
    `, [jobId])).rows[0].count;
    const tasks = (await db.query(`
      SELECT COUNT(*) as count FROM tasks t
      JOIN activities a ON t.activityId = a.id
      JOIN scopes s ON a.scopeId = s.id WHERE s.jobId = $1
    `, [jobId])).rows[0].count;
    const dailyUpdates = (await db.query(`
      SELECT COUNT(*) as count FROM daily_task_updates dtu
      JOIN tasks t ON dtu.taskId = t.id
      JOIN activities a ON t.activityId = a.id
      JOIN scopes s ON a.scopeId = s.id WHERE s.jobId = $1
    `, [jobId])).rows[0].count;
    const pendingUpdates = (await db.query(`
      SELECT COUNT(*) as count FROM daily_task_updates dtu
      JOIN tasks t ON dtu.taskId = t.id
      JOIN activities a ON t.activityId = a.id
      JOIN scopes s ON a.scopeId = s.id WHERE s.jobId = $1 AND dtu.status = 'pending'
    `, [jobId])).rows[0].count;
    const timesheets = (await db.query(`
      SELECT COUNT(*) as count FROM timesheet_entries te
      JOIN activities a ON te.activityId = a.id
      JOIN scopes s ON a.scopeId = s.id WHERE s.jobId = $1
    `, [jobId])).rows[0].count;
    const photos = (await db.query(`
      SELECT COUNT(*) as count FROM task_photos tp
      JOIN daily_task_updates dtu ON tp.dailyTaskUpdateId = dtu.id
      JOIN tasks t ON dtu.taskId = t.id
      JOIN activities a ON t.activityId = a.id
      JOIN scopes s ON a.scopeId = s.id WHERE s.jobId = $1
    `, [jobId])).rows[0].count;
    const workerAssignments = (await db.query(`
      SELECT COUNT(*) as count FROM worker_assignments wa
      JOIN activities a ON wa.activityId = a.id
      JOIN scopes s ON a.scopeId = s.id WHERE s.jobId = $1
    `, [jobId])).rows[0].count;

    res.json({ scopes, activities, tasks, dailyUpdates, pendingUpdates, timesheets, photos, workerAssignments });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
