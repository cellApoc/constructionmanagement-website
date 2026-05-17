/**
 * @file Task CRUD routes with dependency management, Gantt chart data, bulk scheduling,
 * and job photo aggregation. Tasks are the lowest tier of the job work breakdown
 * structure (Scope -> Activity -> Task). Bulk scheduling supports both manual
 * (batch update specific tasks) and auto mode (topological dependency-aware sequencing).
 * All routes require authentication.
 * @module server/routes/tasks
 */

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { auth } = require('../middleware/auth');
const { cascadeSchedule, emitJobEvent } = require('../helpers/automationEngine');

const router = express.Router();

router.use(auth);

/**
 * POST /api/tasks
 * Create a new task under an activity.
 * @param {string} req.body.activityId - Parent activity UUID (required)
 * @param {string} req.body.name - Task name (required)
 * @param {number} [req.body.estimatedQuantity] - Estimated quantity of work, defaults to 0
 * @param {string} [req.body.unit] - Unit of measure (e.g. 'sqft', 'each'), defaults to 'each'
 * @param {string} [req.body.scheduledStartDate] - Scheduled start date (YYYY-MM-DD)
 * @param {string} [req.body.scheduledFinishDate] - Scheduled finish date (YYYY-MM-DD)
 * @param {string} [req.body.baselineStartDate] - Baseline start date (YYYY-MM-DD)
 * @param {string} [req.body.baselineFinishDate] - Baseline finish date (YYYY-MM-DD)
 * @param {number} [req.body.sortOrder] - Display order within the activity, defaults to 0
 * @returns {Object} 201 - The created task object
 * @returns {Object} 400 - { error: string } if activityId or name is missing
 * @returns {Object} 404 - { error: 'Activity not found' }
 */
router.post('/', async (req, res) => {
  try {
    const { activityId, name, estimatedQuantity, unit, scheduledStartDate, scheduledFinishDate, baselineStartDate, baselineFinishDate, sortOrder } = req.body;

    if (!activityId || !name) return res.status(400).json({ error: 'activityId and name are required' });

    const activity = (await db.query(`SELECT id FROM activities WHERE id = $1`, [activityId])).rows[0];
    if (!activity) return res.status(404).json({ error: 'Activity not found' });

    const id = uuidv4();
    (await db.query(`
      INSERT INTO tasks (id, activityId, name, estimatedQuantity, unit, scheduledStartDate, scheduledFinishDate, baselineStartDate, baselineFinishDate, sortOrder)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `, [id, activityId, name, estimatedQuantity || 0, unit || 'each', scheduledStartDate || null, scheduledFinishDate || null, baselineStartDate || null, baselineFinishDate || null, sortOrder || 0]);

    const task = (await db.query(`SELECT * FROM tasks WHERE id = $11`, [id])).rows[0];
    res.status(201).json(task);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/tasks/:id
 * Update an existing task. Fields not provided retain their current values.
 * @param {string} req.params.id - Task UUID
 * @param {string} [req.body.name] - Task name
 * @param {number} [req.body.estimatedQuantity] - Estimated quantity
 * @param {string} [req.body.unit] - Unit of measure
 * @param {number} [req.body.currentPercentComplete] - Current completion percentage (0-100)
 * @param {string} [req.body.scheduledStartDate] - Scheduled start date (YYYY-MM-DD)
 * @param {string} [req.body.scheduledFinishDate] - Scheduled finish date (YYYY-MM-DD)
 * @param {string} [req.body.baselineStartDate] - Baseline start date (YYYY-MM-DD)
 * @param {string} [req.body.baselineFinishDate] - Baseline finish date (YYYY-MM-DD)
 * @param {number} [req.body.sortOrder] - Display order
 * @returns {Object} 200 - The updated task object
 * @returns {Object} 404 - { error: 'Task not found' }
 */
router.put('/:id', async (req, res) => {
  try {
    const existing = await db.query(`SELECT * FROM tasks WHERE id = $12', [req.params.id])).rows[0];
    if (!existing) return res.status(404).json({ error: 'Task not found' });

    const { name, estimatedQuantity, unit, currentPercentComplete, scheduledStartDate, scheduledFinishDate, baselineStartDate, baselineFinishDate, sortOrder } = req.body;

    (await db.query(`
      UPDATE tasks SET name=$13, estimatedQuantity=$14, unit=$15, currentPercentComplete=$16, scheduledStartDate=$17, scheduledFinishDate=$18, baselineStartDate=$19, baselineFinishDate=$20, sortOrder=$21
      WHERE id=$22
    `, [
      name $23$24 existing.name,
      estimatedQuantity $25$26 existing.estimatedQuantity,
      unit $27$28 existing.unit,
      currentPercentComplete $29$30 existing.currentPercentComplete,
      scheduledStartDate $31$32 existing.scheduledStartDate,
      scheduledFinishDate $33$34 existing.scheduledFinishDate,
      baselineStartDate $35$36 existing.baselineStartDate,
      baselineFinishDate $37$38 existing.baselineFinishDate,
      sortOrder $39$40 existing.sortOrder,
      req.params.id
    ]);

    // ── Schedule cascade hook ──
    const newFinish = scheduledFinishDate $41$42 existing.scheduledFinishDate;
    if (scheduledFinishDate && existing.scheduledFinishDate &&
        scheduledFinishDate !== existing.scheduledFinishDate &&
        scheduledFinishDate > existing.scheduledFinishDate) {
      const taskCtx = (await db.query(`
        SELECT s.jobId FROM tasks t
        JOIN activities a ON t.activityId = a.id
        JOIN scopes s ON a.scopeId = s.id
        WHERE t.id = $43
      `, [req.params.id])).rows[0];

      if (taskCtx) {
        const result = cascadeSchedule(req.params.id, scheduledFinishDate, req.user$1.id);
        if (result.totalShifted > 0) {
          console.log(`[Cascade] Task ${req.params.id} slip cascaded to ${result.totalShifted} tasks`);
        }
      }
    }

    const task = (await db.query(`SELECT * FROM tasks WHERE id = $1`, [req.params.id])).rows[0];
    res.json(task);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/tasks/:id
 * Delete a task and cascade-delete all related dependencies, daily updates, and photos.
 * @param {string} req.params.id - Task UUID
 * @returns {Object} 200 - { message: 'Task deleted' }
 * @returns {Object} 404 - { error: 'Task not found' }
 */
router.delete('/:id', async (req, res) => {
  try {
    const existing = (await db.query(`SELECT * FROM tasks WHERE id = $1`, [req.params.id])).rows[0];
    if (!existing) return res.status(404).json({ error: 'Task not found' });

    (await db.query(`DELETE FROM task_dependencies WHERE taskId = $1 OR predecessorTaskId = $2`, [req.params.id, req.params.id]);
    await db.query(`DELETE FROM task_photos WHERE dailyTaskUpdateId IN (SELECT id FROM daily_task_updates WHERE taskId = $3)`, [req.params.id]);
    await db.query(`DELETE FROM daily_task_updates WHERE taskId = $4`, [req.params.id]);
    await db.query(`DELETE FROM tasks WHERE id = $5`, [req.params.id]);

    res.json({ message: 'Task deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/tasks/:id/dependencies
 * Add a dependency (predecessor) to a task.
 * @param {string} req.params.id - Task UUID (the dependent task)
 * @param {string} req.body.predecessorTaskId - Predecessor task UUID (required)
 * @param {string} [req.body.type] - Dependency type, defaults to 'FS' (Finish-to-Start)
 * @returns {Object} 201 - The created task_dependency object
 * @returns {Object} 400 - { error: string } if predecessorTaskId is missing
 * @returns {Object} 404 - { error: string } if task or predecessor not found
 */
router.post('/:id/dependencies', async (req, res) => {
  try {
    const { predecessorTaskId, type } = req.body;
    if (!predecessorTaskId) return res.status(400).json({ error: 'predecessorTaskId is required' });

    const task = await db.query(`SELECT id FROM tasks WHERE id = $6`, [req.params.id])).rows[0];
    if (!task) return res.status(404).json({ error: 'Task not found' });

    const predecessor = (await db.query(`SELECT id FROM tasks WHERE id = $1`, [predecessorTaskId])).rows[0];
    if (!predecessor) return res.status(404).json({ error: 'Predecessor task not found' });

    const id = uuidv4();
    await db.query('INSERT INTO task_dependencies (id, taskId, predecessorTaskId, type) VALUES ($2, $3, $4, $5)', [id, req.params.id, predecessorTaskId, type || 'FS']);

    const dep = (await db.query(`SELECT * FROM task_dependencies WHERE id = $1`, [id])).rows[0];
    res.status(201).json(dep);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/tasks/:id/dependencies/:depId
 * Remove a dependency from a task.
 * @param {string} req.params.id - Task UUID
 * @param {string} req.params.depId - Task dependency UUID to remove
 * @returns {Object} 200 - { message: 'Dependency removed' }
 * @returns {Object} 404 - { error: 'Dependency not found' }
 */
router.delete('/:id/dependencies/:depId', async (req, res) => {
  try {
    const result = await db.query('DELETE FROM task_dependencies WHERE id = $6 AND taskId = $7', [req.params.depId, req.params.id]);
    if (result.changes === 0) return res.status(404).json({ error: 'Dependency not found' });

    res.json({ message: 'Dependency removed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/tasks/my
 * Retrieve all tasks assigned to the current user (via worker_assignments on activities).
 * Returns tasks grouped with job and activity context.
 * @returns {Object[]} 200 - Array of task objects with jobId, jobName, scopeName, activityName
 */
router.get('/my', async (req, res) => {
  try {
    const tasks = (await db.query(`
      SELECT t.*, a.name as activityName, s.name as scopeName,
             j.id as jobId, j.name as jobName, j.status as jobStatus
      FROM tasks t
      JOIN activities a ON t.activityId = a.id
      JOIN scopes s ON a.scopeId = s.id
      JOIN jobs j ON s.jobId = j.id
      JOIN worker_assignments wa ON wa.activityId = a.id AND wa.workerId = $8
      WHERE j.status = 'active'
      ORDER BY t.scheduledFinishDate ASC, j.name, s.sortOrder, a.sortOrder, t.sortOrder
    `, [req.user.id])).rows;

    res.json(tasks);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/tasks/job/:jobId/gantt
 * Retrieve all tasks for a job formatted for Gantt chart rendering, ordered by
 * scope -> activity -> task sort order. Includes scope and activity names and task dependencies.
 * @param {string} req.params.jobId - Job UUID
 * @returns {Object[]} 200 - Array of task objects with activityName, scopeName, scopeId, activityId, and dependencies array
 */
router.get('/job/:jobId/gantt', async (req, res) => {
  try {
    const tasks = (await db.query(`
      SELECT t.*, a.name as activityName, s.name as scopeName, s.id as scopeId, a.id as activityId
      FROM tasks t
      JOIN activities a ON t.activityId = a.id
      JOIN scopes s ON a.scopeId = s.id
      WHERE s.jobId = $9
      ORDER BY s.sortOrder, a.sortOrder, t.sortOrder
    `, [req.params.jobId])).rows;

    const tasksWithDeps = tasks.map(task => {
      const dependencies = (await db.query('SELECT * FROM task_dependencies WHERE taskId = $10`, [task.id])).rows;
      return { ...task, dependencies };
    });

    res.json(tasksWithDeps);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/tasks/bulk-schedule
 * Batch-update scheduled dates for multiple tasks at once. Optionally auto-schedules
 * tasks sequentially from a start date based on dependency order.
 * @param {string} [req.body.mode] - 'manual' (default) or 'auto'
 * @param {Object[]} [req.body.tasks] - For manual mode: array of { id, scheduledStartDate, scheduledFinishDate }
 * @param {string} [req.body.jobId] - For auto mode: job UUID to auto-schedule all tasks
 * @param {string} [req.body.startDate] - For auto mode: project start date (YYYY-MM-DD)
 * @param {number} [req.body.defaultDuration] - For auto mode: default task duration in days (default 5)
 * @returns {Object} 200 - { updated: number } count of tasks updated
 * @returns {Object} 400 - { error: string } if required fields missing
 */
router.put('/bulk-schedule', async (req, res) => {
  try {
    const { mode, tasks: taskUpdates, jobId, startDate, defaultDuration } = req.body;

    if (mode === 'auto') {
      // Auto-schedule: sequence tasks by dependency order from a start date
      if (!jobId || !startDate) {
        return res.status(400).json({ error: 'jobId and startDate are required for auto mode' });
      }

      const allTasks = (await db.query(`
        SELECT t.*, s.sortOrder as scopeSort, a.sortOrder as activitySort
        FROM tasks t
        JOIN activities a ON t.activityId = a.id
        JOIN scopes s ON a.scopeId = s.id
        WHERE s.jobId = $1
        ORDER BY s.sortOrder, a.sortOrder, t.sortOrder
      `, [jobId])).rows;

      const deps = (await db.query(`
        SELECT td.taskId, td.predecessorTaskId
        FROM task_dependencies td
        JOIN tasks t ON td.taskId = t.id
        JOIN activities a ON t.activityId = a.id
        JOIN scopes s ON a.scopeId = s.id
        WHERE s.jobId = $1
      `, [jobId])).rows;

      const depsMap = {};
      deps.forEach(d => {
        if (!depsMap[d.taskId]) depsMap[d.taskId] = [];
        depsMap[d.taskId].push(d.predecessorTaskId);
      });

      const durDays = defaultDuration || 5;
      const scheduled = {}; // taskId -> { start, finish }
      const addDays = (dateStr, days) => {
        const d = new Date(dateStr);
        d.setDate(d.getDate() + days);
        return d.toISOString().split('T')[0];
      };

      // Topological scheduling
      function scheduleTask(taskId) {
        if (scheduled[taskId]) return scheduled[taskId];
        const predecessors = depsMap[taskId] || [];
        let earliestStart = startDate;
        for (const predId of predecessors) {
          const predSchedule = scheduleTask(predId);
          if (predSchedule && predSchedule.finish > earliestStart) {
            earliestStart = addDays(predSchedule.finish, 1);
          }
        }
        const finish = addDays(earliestStart, durDays - 1);
        scheduled[taskId] = { start: earliestStart, finish };
        return scheduled[taskId];
      }

      allTasks.forEach(t => scheduleTask(t.id));

      // Prepared statement converted to inline query
    const updateStmt_sql = `UPDATE tasks SET scheduledStartDate=$1, scheduledFinishDate=$2 WHERE id=$3`;
      const client = await db.getClient();
    try {
      await client.query('BEGIN');

        allTasks.forEach(t => {
          const s = scheduled[t.id];
          if (s) await db.query(updateStmt_sql, [s.start, s.finish, t.id]);
        });
      
      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }

      return res.json({ updated: allTasks.length });
    }

    // Manual mode: update specific tasks
    if (!Array.isArray(taskUpdates) || taskUpdates.length === 0) {
      return res.status(400).json({ error: 'tasks array is required for manual mode' });
    }

    // Prepared statement converted to inline query
    const updateStmt_sql = `UPDATE tasks SET scheduledStartDate=$1, scheduledFinishDate=$2 WHERE id=$3`;
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      for (const t of taskUpdates) {
        if (t.id) {
          await db.query(updateStmt_sql, [t.scheduledStartDate || null, t.scheduledFinishDate || null, t.id]);
        }
      }
    
      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }

    res.json({ updated: taskUpdates.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/tasks/job/:jobId/photos
 * Retrieve all photos for a job grouped by date and task. Returns a flat array
 * of photo objects with task/activity/scope/worker context for client-side grouping.
 * More efficient than N+1 queries from the client iterating each task.
 * @param {string} req.params.jobId - Job UUID
 * @returns {Object[]} 200 - Array of photo objects with context fields
 */
router.get('/job/:jobId/photos', async (req, res) => {
  try {
    const photos = (await db.query(`
      SELECT tp.id, tp.filename, tp.originalName, tp.uploadedAt,
        dtu.date, dtu.percentComplete, dtu.notes as updateNotes, dtu.status as updateStatus,
        t.name as taskName, t.id as taskId,
        a.name as activityName, s.name as scopeName,
        u.name as workerName
      FROM task_photos tp
      JOIN daily_task_updates dtu ON tp.dailyTaskUpdateId = dtu.id
      JOIN tasks t ON dtu.taskId = t.id
      JOIN activities a ON t.activityId = a.id
      JOIN scopes s ON a.scopeId = s.id
      JOIN users u ON dtu.workerId = u.id
      WHERE s.jobId = $1
      ORDER BY dtu.date DESC, t.name, tp.uploadedAt DESC
    `, [req.params.jobId])).rows;

    res.json(photos);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
