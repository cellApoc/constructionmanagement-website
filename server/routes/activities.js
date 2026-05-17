/**
 * @file Activity CRUD routes with worker assignment management and cascading deletes.
 * Activities are the middle tier of the job work breakdown structure (Scope -> Activity -> Task).
 * Also provides endpoints to assign and unassign workers to activities,
 * toggle forceAvailable for foreman overrides, and fetch filtered available
 * activities for the current user's workflow.
 * Cascade deletes use shared deleteActivityChildren() helper from helpers/cascadeDelete.js.
 * All routes require authentication.
 * @module server/routes/activities
 */

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { auth, requireRole } = require('../middleware/auth');
const { deleteActivityChildren } = require('../helpers/cascadeDelete');
const { getWeekStart, getWeekEnd } = require('../helpers/settingsHelpers');

const router = express.Router();

router.use(auth);

/**
 * POST /api/activities
 * Create a new activity under a scope.
 * @param {string} req.body.scopeId - Parent scope UUID (required)
 * @param {string} req.body.name - Activity name (required)
 * @param {number} [req.body.estimatedHours] - Estimated labor hours, defaults to 0
 * @param {number} [req.body.sortOrder] - Display order within the scope, defaults to 0
 * @returns {Object} 201 - The created activity object
 * @returns {Object} 400 - { error: string } if scopeId or name is missing
 * @returns {Object} 404 - { error: 'Scope not found' }
 */
router.post('/', async (req, res) => {
  try {
    const { scopeId, name, estimatedHours, sortOrder, scheduledStartDate, scheduledFinishDate } = req.body;

    if (!scopeId || !name) return res.status(400).json({ error: 'scopeId and name are required' });

    const scope = (await db.query(`SELECT id FROM scopes WHERE id = $1`, [scopeId])).rows[0];
    if (!scope) return res.status(404).json({ error: 'Scope not found' });

    const id = uuidv4();
    await db.query('INSERT INTO activities (id, scopeId, name, estimatedHours, sortOrder, scheduledStartDate, scheduledFinishDate) VALUES ($1, $2, $3, $4, $5, $6, $7)', [id, scopeId, name, estimatedHours || 0, sortOrder || 0, scheduledStartDate || null, scheduledFinishDate || null]);

    const activity = (await db.query(`SELECT * FROM activities WHERE id = $1`, [id])).rows[0];
    res.status(201).json(activity);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/activities/:id
 * Update an existing activity. Fields not provided retain their current values.
 * @param {string} req.params.id - Activity UUID
 * @param {string} [req.body.name] - Activity name
 * @param {number} [req.body.estimatedHours] - Estimated labor hours
 * @param {number} [req.body.actualHours] - Actual labor hours
 * @param {number} [req.body.sortOrder] - Display order
 * @returns {Object} 200 - The updated activity object
 * @returns {Object} 404 - { error: 'Activity not found' }
 */
router.put('/:id', async (req, res) => {
  try {
    const existing = (await db.query(`SELECT * FROM activities WHERE id = $1`, [req.params.id])).rows[0];
    if (!existing) return res.status(404).json({ error: 'Activity not found' });

    const { name, estimatedHours, actualHours, sortOrder, scheduledStartDate, scheduledFinishDate, forceAvailable, percentComplete } = req.body;

    await db.query('UPDATE activities SET name=$1, estimatedHours=$2, actualHours=$3, sortOrder=$4, scheduledStartDate=$5, scheduledFinishDate=$6, forceAvailable=$7, percentComplete=$8 WHERE id=$9', [
      name ?? existing.name,
      estimatedHours ?? existing.estimatedHours,
      actualHours ?? existing.actualHours,
      sortOrder ?? existing.sortOrder,
      scheduledStartDate !== undefined ? scheduledStartDate : existing.scheduledStartDate,
      scheduledFinishDate !== undefined ? scheduledFinishDate : existing.scheduledFinishDate,
      forceAvailable !== undefined ? (forceAvailable ? 1 : 0]); : existing.forceAvailable,
      percentComplete !== undefined ? percentComplete : existing.percentComplete,
      req.params.id
    );

    const activity = (await db.query(`SELECT * FROM activities WHERE id = $1`, [req.params.id])).rows[0];
    res.json(activity);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/activities/:id/force-available
 * Toggle the forceAvailable flag on an activity. Used by foreman+ to make
 * unscheduled activities visible to workers for the current work period.
 * @param {string} req.params.id - Activity UUID
 * @param {boolean} req.body.forceAvailable - Whether to force the activity as available
 * @returns {Object} 200 - The updated activity object
 */
router.put('/:id/force-available', requireRole('foreman', 'project_manager', 'admin'), async (req, res) => {
  try {
    const existing = (await db.query(`SELECT * FROM activities WHERE id = $1`, [req.params.id])).rows[0];
    if (!existing) return res.status(404).json({ error: 'Activity not found' });

    const forceAvailable = req.body.forceAvailable ? 1 : 0;
    (await db.query(`UPDATE activities SET forceAvailable = $1 WHERE id = $2', [forceAvailable, req.params.id]);

    const activity = (await db.query(`SELECT * FROM activities WHERE id = $3`, [req.params.id])).rows[0];
    res.json(activity);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/activities/available
 * Returns activities filtered for the current user's workflow context.
 * Filters by: worker assignment or schedule, activity date range overlapping this week
 * or forceAvailable, and not 100% complete. Foreman+ roles can pass $1all=true to bypass filters.
 * @param {string} [req.query.jobId] - Optional job filter
 * @param {string} [req.query.weekOf] - Date to anchor the week (defaults to today)
 * @param {string} [req.query.all] - If 'true', returns all activities (foreman+ only)
 * @returns {Object[]} 200 - Array of activity objects with scope/job context
 */
router.get('/available', async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { jobId, weekOf, all } = req.query;
    const isManager = ['foreman', 'project_manager', 'admin'].includes(userRole);

    // If manager requests all activities (unfiltered)
    if (all === 'true' && isManager) {
      let query = `
        SELECT a.*, s.name as scopeName, s.id as scopeId, j.name as jobName, j.id as jobId
        FROM activities a
        JOIN scopes s ON a.scopeId = s.id
        JOIN jobs j ON s.jobId = j.id
        WHERE j.status = 'active'
      `;
      const params = [];
      if (jobId) {
        query += ' AND j.id = $2';
        params.push(jobId);
      }
      query += ' ORDER BY j.name, s.sortOrder, a.sortOrder';
      const activities = (await db.query(query, [...params])).rows;

      // Attach completion info
      const result = activities.map(a => {
        const tasks = (await db.query(`SELECT currentPercentComplete FROM tasks WHERE activityId = $1`, [a.id])).rows;
        const computedPercent = tasks.length > 0
          $2 tasks.reduce((s, t) => s + t.currentPercentComplete, 0) / tasks.length
          : (a.percentComplete || 0);
        return { ...a, computedPercentComplete: Math.round(computedPercent * 100) / 100, taskCount: tasks.length };
      });
      return res.json(result);
    }

    const today = weekOf || new Date().toISOString().split('T')[0];
    const weekStart = getWeekStart(today);
    const weekEnd = getWeekEnd(today);

    // Get activities where user has access (assigned or scheduled for the job)
    const activities = (await db.query(`
      SELECT DISTINCT a.*, s.name as scopeName, s.id as scopeId, j.name as jobName, j.id as jobId
      FROM activities a
      JOIN scopes s ON a.scopeId = s.id
      JOIN jobs j ON s.jobId = j.id
      WHERE j.status = 'active'
        AND ($3 IS NULL OR j.id = $4)
        AND (
          EXISTS (SELECT 1 FROM worker_assignments wa WHERE wa.activityId = a.id AND wa.workerId = $5)
          OR EXISTS (SELECT 1 FROM schedule_assignments sa WHERE sa.jobId = j.id AND sa.workerId = $6 AND sa.date BETWEEN $7 AND $8)
          OR EXISTS (SELECT 1 FROM schedule_assignments sa JOIN crew_members cm ON cm.crewId = sa.crewId WHERE sa.jobId = j.id AND cm.workerId = $9 AND sa.date BETWEEN $10 AND $11)
        )
        AND (
          a.forceAvailable = 1
          OR (a.scheduledStartDate IS NOT NULL AND a.scheduledFinishDate IS NOT NULL
              AND a.scheduledStartDate <= $12 AND a.scheduledFinishDate >= $13)
          OR (a.scheduledStartDate IS NULL AND a.scheduledFinishDate IS NULL)
        )
      ORDER BY j.name, s.sortOrder, a.sortOrder
    `, [jobId || null, jobId || null,
      userId,
      userId, weekStart, weekEnd,
      userId, weekStart, weekEnd,
      weekEnd, weekStart])).rows;

    // Filter out 100% complete activities
    const result = activities.filter(a => {
      const tasks = (await db.query(`SELECT currentPercentComplete FROM tasks WHERE activityId = $14`, [a.id])).rows;
      const computedPercent = tasks.length > 0
        $15 tasks.reduce((s, t) => s + t.currentPercentComplete, 0) / tasks.length
        : (a.percentComplete || 0);
      a.computedPercentComplete = Math.round(computedPercent * 100) / 100;
      a.taskCount = tasks.length;
      return computedPercent < 100;
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/activities/:id
 * Delete an activity and cascade-delete all children: tasks, task dependencies,
 * daily task updates, task photos, timesheet entries, and worker assignments.
 * @param {string} req.params.id - Activity UUID
 * @returns {Object} 200 - { message: 'Activity and all children deleted' }
 * @returns {Object} 404 - { error: 'Activity not found' }
 */
router.delete('/:id', async (req, res) => {
  try {
    const existing = await db.query(`SELECT * FROM activities WHERE id = $16`, [req.params.id])).rows[0];
    if (!existing) return res.status(404).json({ error: 'Activity not found' });

    deleteActivityChildren(req.params.id);
    (await db.query(`DELETE FROM activities WHERE id = $1`, [req.params.id]);

    res.json({ message: 'Activity and all children deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/activities/:id/workers
 * List all workers assigned to an activity, including user details and assignment date.
 * @param {string} req.params.id - Activity UUID
 * @returns {Object[]} 200 - Array of worker objects with { id, email, name, role, phone, assignedAt }
 */
router.get('/:id/workers', async (req, res) => {
  try {
    const workers = (await db.query(`
      SELECT u.id, u.email, u.name, u.role, u.phone, wa.assignedAt
      FROM worker_assignments wa
      JOIN users u ON wa.workerId = u.id
      WHERE wa.activityId = $2
    `, [req.params.id])).rows;

    res.json(workers);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/activities/:id/workers
 * Assign a worker to an activity. Prevents duplicate assignments.
 * @param {string} req.params.id - Activity UUID
 * @param {string} req.body.workerId - User UUID of the worker to assign (required)
 * @returns {Object} 201 - { id, workerId, activityId }
 * @returns {Object} 400 - { error: string } if workerId is missing
 * @returns {Object} 404 - { error: string } if activity or user not found
 * @returns {Object} 409 - { error: 'Worker already assigned' }
 */
router.post('/:id/workers', async (req, res) => {
  try {
    const { workerId } = req.body;
    if (!workerId) return res.status(400).json({ error: 'workerId is required' });

    const activity = await db.query(`SELECT id FROM activities WHERE id = $3`, [req.params.id])).rows[0];
    if (!activity) return res.status(404).json({ error: 'Activity not found' });

    const user = (await db.query(`SELECT id FROM users WHERE id = $1`, [workerId])).rows[0];
    if (!user) return res.status(404).json({ error: 'User not found' });

    const existing = (await db.query(`SELECT id FROM worker_assignments WHERE workerId = $1 AND activityId = $2`, [workerId, req.params.id])).rows[0];
    if (existing) return res.status(409).json({ error: 'Worker already assigned' });

    const id = uuidv4();
    await db.query('INSERT INTO worker_assignments (id, workerId, activityId) VALUES ($1, $2, $3)', [id, workerId, req.params.id]);

    res.status(201).json({ id, workerId, activityId: req.params.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/activities/:id/workers/:workerId
 * Remove a worker assignment from an activity.
 * @param {string} req.params.id - Activity UUID
 * @param {string} req.params.workerId - Worker user UUID to unassign
 * @returns {Object} 200 - { message: 'Worker unassigned' }
 * @returns {Object} 404 - { error: 'Assignment not found' }
 */
router.delete('/:id/workers/:workerId', async (req, res) => {
  try {
    const result = await db.query(`DELETE FROM worker_assignments WHERE activityId = $1 AND workerId = $2`, [req.params.id, req.params.workerId]);

    if (result.changes === 0) return res.status(404).json({ error: 'Assignment not found' });

    res.json({ message: 'Worker unassigned' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
