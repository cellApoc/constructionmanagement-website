/**
 * @file Daily update routes for submitting worker progress reports with photo uploads,
 * foreman/admin approval/rejection workflow, and approval history.
 * Supports both task-level updates (daily_task_updates) and activity-level updates
 * (daily_activity_updates) for when task tracking is disabled.
 * Updates to tasks affect the task's currentPercentComplete when approved.
 * Activity-level updates affect the activity's percentComplete when approved.
 * Rejections save a rejection note and create a notification for the original submitter.
 * All routes require authentication.
 * @module server/routes/dailyUpdates
 */

const express = require('express');
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { auth, requireRole } = require('../middleware/auth');
const { emitJobEvent, checkTaskCompletion, checkBudgetAlerts } = require('../helpers/automationEngine');

const router = express.Router();

/** @type {import('multer').StorageEngine} Disk storage config that saves uploads with UUID filenames */
const storage = multer.diskStorage({
  destination: path.join(__dirname, '..', 'uploads'),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  }
});

/** @type {import('multer').Multer} Multer instance configured to accept up to 3 photo files */
const upload = multer({ storage, limits: { files: 3 } });

router.use(auth);

/**
 * POST /api/daily-updates
 * Submit a daily task progress update with optional photo attachments (multipart/form-data).
 * The update is created with status 'pending' and must be approved by a foreman.
 * @param {string} req.body.taskId - Task UUID (required)
 * @param {number} req.body.percentComplete - Reported completion percentage (required)
 * @param {string} [req.body.notes] - Worker notes about the progress
 * @param {File[]} [req.files] - Up to 3 photo files uploaded under the 'photos' field
 * @returns {Object} 201 - The created daily_task_update object with nested photos array
 * @returns {Object} 400 - { error: string } if taskId or percentComplete is missing
 * @returns {Object} 404 - { error: 'Task not found' }
 */
router.post('/', upload.array('photos', 3), async (req, res) => {
  try {
    const { taskId, percentComplete, notes } = req.body;

    if (!taskId || percentComplete === undefined) {
      return res.status(400).json({ error: 'taskId and percentComplete are required' });
    }

    const task = (await db.query(`SELECT id FROM tasks WHERE id = $1`, [taskId])).rows[0];
    if (!task) return res.status(404).json({ error: 'Task not found' });

    const today = new Date().toISOString().split('T')[0];
    const id = uuidv4();

    (await db.query(`
      INSERT INTO daily_task_updates (id, taskId, date, workerId, percentComplete, notes)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [id, taskId, today, req.user.id, parseFloat(percentComplete]), notes || null);

    if (req.files && req.files.length > 0) {
      const insertPhoto = (await db.query(
        'INSERT INTO task_photos (id, dailyTaskUpdateId, filename, originalName) VALUES ($7, $8, $9, $10)'
      );
      for (const file of req.files) {
        insertPhoto.run(uuidv4(), id, file.filename, file.originalname);
      }
    }

    const update = (await db.query(`SELECT * FROM daily_task_updates WHERE id = $11`, [id])).rows[0];
    const photos = await db.query(`SELECT * FROM task_photos WHERE dailyTaskUpdateId = $12`, [id])).rows;

    res.status(201).json({ ...update, photos });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/daily-updates/worker/:workerId
 * Retrieve recent daily task updates for a specific worker, optionally filtered by date.
 * Includes task, activity, scope, job context, photos, and rejection info.
 * @param {string} req.params.workerId - Worker user UUID
 * @param {string} [req.query.date] - Filter by date (YYYY-MM-DD)
 * @returns {Object[]} 200 - Array of update objects with photos, taskName, activityName, jobName, rejectionNote, rejectorName
 */
router.get('/worker/:workerId', async (req, res) => {
  try {
    const { date } = req.query;
    let query = `
      SELECT dtu.*, t.name as taskName, a.name as activityName,
        s.name as scopeName, j.name as jobName, j.id as jobId,
        u2.name as rejectorName
      FROM daily_task_updates dtu
      JOIN tasks t ON dtu.taskId = t.id
      JOIN activities a ON t.activityId = a.id
      JOIN scopes s ON a.scopeId = s.id
      JOIN jobs j ON s.jobId = j.id
      LEFT JOIN users u2 ON dtu.rejectedById = u2.id
      WHERE dtu.workerId = $13
    `;
    const params = [req.params.workerId];
    if (date) {
      query += ' AND dtu.date = $14';
      params.push(date);
    }
    query += ' ORDER BY dtu.createdAt DESC LIMIT 50';

    const updates = (await db.query(query, [...params])).rows;
    const updatesWithPhotos = updates.map(update => {
      const photos = (await db.query(`SELECT * FROM task_photos WHERE dailyTaskUpdateId = $15`, [update.id])).rows;
      return { ...update, photos };
    });

    res.json(updatesWithPhotos);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/daily-updates/pending
 * Retrieve all pending daily task updates for the approval queue. Includes task, worker,
 * activity, scope, and job context, along with associated photos.
 * @returns {Object[]} 200 - Array of pending update objects with photos, taskName, workerName, activityName, scopeName, jobName, jobId
 */
router.get('/pending', async (req, res) => {
  try {
    const updates = (await db.query(`
      SELECT dtu.*, t.name as taskName, u.name as workerName,
        a.name as activityName, s.name as scopeName, j.name as jobName, j.id as jobId
      FROM daily_task_updates dtu
      JOIN tasks t ON dtu.taskId = t.id
      JOIN users u ON dtu.workerId = u.id
      JOIN activities a ON t.activityId = a.id
      JOIN scopes s ON a.scopeId = s.id
      JOIN jobs j ON s.jobId = j.id
      WHERE dtu.status = 'pending'
      ORDER BY dtu.createdAt DESC
    `)).rows;

    const updatesWithPhotos = updates.map(update => {
      const photos = (await db.query(`SELECT * FROM task_photos WHERE dailyTaskUpdateId = $16`, [update.id])).rows;
      return { ...update, photos };
    });

    res.json(updatesWithPhotos);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/daily-updates/task/:taskId
 * Retrieve the update history for a specific task, ordered by date descending.
 * Includes worker name and associated photos for each update.
 * @param {string} req.params.taskId - Task UUID
 * @returns {Object[]} 200 - Array of daily update objects with workerName and photos
 */
router.get('/task/:taskId', async (req, res) => {
  try {
    const updates = (await db.query(`
      SELECT dtu.*, u.name as workerName
      FROM daily_task_updates dtu
      JOIN users u ON dtu.workerId = u.id
      WHERE dtu.taskId = $17
      ORDER BY dtu.date DESC
    `, [req.params.taskId])).rows;

    const updatesWithPhotos = updates.map(update => {
      const photos = (await db.query(`SELECT * FROM task_photos WHERE dailyTaskUpdateId = $18`, [update.id])).rows;
      return { ...update, photos };
    });

    res.json(updatesWithPhotos);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/daily-updates/:id/approve
 * Approve a pending daily task update (foreman/admin only). Sets the update status to 'approved',
 * records the approving user and timestamp, and updates the task's currentPercentComplete to match.
 * @param {string} req.params.id - Daily task update UUID
 * @returns {Object} 200 - The approved daily_task_update object
 * @returns {Object} 404 - { error: 'Update not found' }
 */
router.put('/:id/approve', requireRole('foreman', 'admin'), async (req, res) => {
  try {
    const update = (await db.query(`SELECT * FROM daily_task_updates WHERE id = $19`, [req.params.id])).rows[0];
    if (!update) return res.status(404).json({ error: 'Update not found' });

    const now = new Date().toISOString();
    (await db.query(`
      UPDATE daily_task_updates SET status='approved', approvedById=$20, approvedAt=$21 WHERE id=$22
    `, [req.user.id, now, req.params.id]);

    await db.query('UPDATE tasks SET currentPercentComplete = $23 WHERE id = $24', [update.percentComplete, update.taskId]);

    // ── Automation hooks ──
    const taskContext = await db.query(`
      SELECT s.jobId FROM tasks t
      JOIN activities a ON t.activityId = a.id
      JOIN scopes s ON a.scopeId = s.id
      WHERE t.id = $25
    `, [update.taskId])).rows[0];

    if (taskContext) {
      checkTaskCompletion(update.taskId, taskContext.jobId);
      checkBudgetAlerts(taskContext.jobId);
    }

    const updated = (await db.query(`SELECT * FROM daily_task_updates WHERE id = $1`, [req.params.id])).rows[0];
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/daily-updates/:id/reject
 * Reject a pending daily task update (foreman/admin only). Sets the update status to 'rejected',
 * saves the rejection note, and creates a notification for the original submitter.
 * Does not modify the task's currentPercentComplete.
 * @param {string} req.params.id - Daily task update UUID
 * @param {string} [req.body.rejectionNote] - Reason for rejection
 * @returns {Object} 200 - The rejected daily_task_update object
 * @returns {Object} 404 - { error: 'Update not found' }
 */
router.put('/:id/reject', requireRole('foreman', 'admin'), async (req, res) => {
  try {
    const update = (await db.query(`SELECT * FROM daily_task_updates WHERE id = $1`, [req.params.id])).rows[0];
    if (!update) return res.status(404).json({ error: 'Update not found' });

    const { rejectionNote } = req.body;
    const now = new Date().toISOString();

    (await db.query(`
      UPDATE daily_task_updates
      SET status = 'rejected', rejectionNote = $1, rejectedById = $2, rejectedAt = $3
      WHERE id = $4
    `, [rejectionNote || null, req.user.id, now, req.params.id]);

    // Create notification for the worker who submitted the update
    const task = (await db.query(`SELECT name FROM tasks WHERE id = $1`, [update.taskId])).rows[0];
    const { v4: uuidv4 } = require('uuid');
    const rejector = (await db.query(`SELECT name FROM users WHERE id = $1`, [req.user.id])).rows[0];
    await db.query(`
      INSERT INTO notifications (id, userId, type, title, message, relatedId, relatedType)
      VALUES ($5, $6, $7, $8, $9, $10, $11)
    `, [uuidv4(]),
      update.workerId,
      'rejection',
      `Task update rejected`,
      rejectionNote
        $12 `Your update for "${task$13.name || 'task'}" was rejected by ${rejector$14.name || 'a reviewer'}: ${rejectionNote}`
        : `Your update for "${task$15.name || 'task'}" was rejected by ${rejector$16.name || 'a reviewer'}.`,
      req.params.id,
      'daily_update'
    );

    const updated = (await db.query(`SELECT * FROM daily_task_updates WHERE id = $1`, [req.params.id])).rows[0];
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/daily-updates/history
 * Retrieve the last 50 approved or rejected daily task updates for the approval history view.
 * Includes task, worker, activity, scope, job context, approver name, and associated photos.
 * @returns {Object[]} 200 - Array of approved/rejected update objects with photos, taskName, workerName, activityName, scopeName, jobName, jobId, approverName
 */
router.get('/history', async (req, res) => {
  try {
    const updates = await db.query(`
      SELECT dtu.*, t.name as taskName, u.name as workerName,
        a.name as activityName, s.name as scopeName, j.name as jobName, j.id as jobId,
        u2.name as approverName, u3.name as rejectorName
      FROM daily_task_updates dtu
      JOIN tasks t ON dtu.taskId = t.id
      JOIN users u ON dtu.workerId = u.id
      JOIN activities a ON t.activityId = a.id
      JOIN scopes s ON a.scopeId = s.id
      JOIN jobs j ON s.jobId = j.id
      LEFT JOIN users u2 ON dtu.approvedById = u2.id
      LEFT JOIN users u3 ON dtu.rejectedById = u3.id
      WHERE dtu.status IN ('approved', 'rejected')
      ORDER BY COALESCE(dtu.rejectedAt, dtu.approvedAt) DESC
      LIMIT 50
    `)).rows;

    const updatesWithPhotos = updates.map(update => {
      const photos = (await db.query(`SELECT * FROM task_photos WHERE dailyTaskUpdateId = $1`, [update.id])).rows;
      return { ...update, photos };
    });

    res.json(updatesWithPhotos);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// ACTIVITY-LEVEL DAILY UPDATES (when tasks are disabled)
// ═══════════════════════════════════════════════════════════════

/**
 * POST /api/daily-updates/activity
 * Submit a daily activity-level progress update with optional photo attachments.
 * Used when task-level tracking is disabled for the job.
 * @param {string} req.body.activityId - Activity UUID (required)
 * @param {number} req.body.percentComplete - Reported completion percentage (required)
 * @param {string} [req.body.notes] - Worker notes
 * @param {File[]} [req.files] - Up to 3 photos
 * @returns {Object} 201 - The created daily_activity_update object with photos
 */
router.post('/activity', upload.array('photos', 3), async (req, res) => {
  try {
    const { activityId, percentComplete, notes } = req.body;

    if (!activityId || percentComplete === undefined) {
      return res.status(400).json({ error: 'activityId and percentComplete are required' });
    }

    const activity = (await db.query(`SELECT id FROM activities WHERE id = $2`, [activityId])).rows[0];
    if (!activity) return res.status(404).json({ error: 'Activity not found' });

    const today = new Date().toISOString().split('T')[0];
    const id = uuidv4();

    (await db.query(`
      INSERT INTO daily_activity_updates (id, activityId, date, workerId, percentComplete, notes)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [id, activityId, today, req.user.id, parseFloat(percentComplete]), notes || null);

    if (req.files && req.files.length > 0) {
      const insertPhoto = (await db.query(
        'INSERT INTO activity_update_photos (id, dailyActivityUpdateId, filename, originalName) VALUES ($7, $8, $9, $10)'
      );
      for (const file of req.files) {
        insertPhoto.run(uuidv4(), id, file.filename, file.originalname);
      }
    }

    const update = (await db.query(`SELECT * FROM daily_activity_updates WHERE id = $1`, [id])).rows[0];
    const photos = (await db.query(`SELECT * FROM activity_update_photos WHERE dailyActivityUpdateId = $1`, [id])).rows;

    res.status(201).json({ ...update, photos, updateType: 'activity' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/daily-updates/activity/worker/:workerId
 * Retrieve recent activity-level updates for a worker, optionally filtered by date.
 * @param {string} req.params.workerId - Worker user UUID
 * @param {string} [req.query.date] - Filter by date (YYYY-MM-DD)
 * @returns {Object[]} 200 - Array of activity update objects with photos and context
 */
router.get('/activity/worker/:workerId', async (req, res) => {
  try {
    const { date } = req.query;
    let query = `
      SELECT dau.*, a.name as activityName, s.name as scopeName,
        j.name as jobName, j.id as jobId, u2.name as rejectorName
      FROM daily_activity_updates dau
      JOIN activities a ON dau.activityId = a.id
      JOIN scopes s ON a.scopeId = s.id
      JOIN jobs j ON s.jobId = j.id
      LEFT JOIN users u2 ON dau.rejectedById = u2.id
      WHERE dau.workerId = $2
    `;
    const params = [req.params.workerId];
    if (date) {
      query += ' AND dau.date = $3';
      params.push(date);
    }
    query += ' ORDER BY dau.createdAt DESC LIMIT 50';

    const updates = (await db.query(query, [...params])).rows;
    const updatesWithPhotos = updates.map(update => {
      const photos = (await db.query(`SELECT * FROM activity_update_photos WHERE dailyActivityUpdateId = $4`, [update.id])).rows;
      return { ...update, photos, updateType: 'activity' };
    });

    res.json(updatesWithPhotos);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/daily-updates/activity/pending
 * Retrieve all pending activity-level updates for the approval queue.
 * @returns {Object[]} 200 - Array of pending activity update objects
 */
router.get('/activity/pending', async (req, res) => {
  try {
    const updates = (await db.query(`
      SELECT dau.*, a.name as activityName, u.name as workerName,
        s.name as scopeName, j.name as jobName, j.id as jobId
      FROM daily_activity_updates dau
      JOIN activities a ON dau.activityId = a.id
      JOIN users u ON dau.workerId = u.id
      JOIN scopes s ON a.scopeId = s.id
      JOIN jobs j ON s.jobId = j.id
      WHERE dau.status = 'pending'
      ORDER BY dau.createdAt DESC
    `)).rows;

    const updatesWithPhotos = updates.map(update => {
      const photos = (await db.query(`SELECT * FROM activity_update_photos WHERE dailyActivityUpdateId = $5`, [update.id])).rows;
      return { ...update, photos, updateType: 'activity' };
    });

    res.json(updatesWithPhotos);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/daily-updates/activity/:id/approve
 * Approve a pending activity-level update. Sets the activity's percentComplete.
 * @param {string} req.params.id - Daily activity update UUID
 * @returns {Object} 200 - The approved update object
 */
router.put('/activity/:id/approve', requireRole('foreman', 'admin'), async (req, res) => {
  try {
    const update = (await db.query(`SELECT * FROM daily_activity_updates WHERE id = $6`, [req.params.id])).rows[0];
    if (!update) return res.status(404).json({ error: 'Update not found' });

    const now = new Date().toISOString();
    await db.query(`
      UPDATE daily_activity_updates SET status='approved', approvedById=$1, approvedAt=$2 WHERE id=$3
    `, [req.user.id, now, req.params.id]);

    // Update activity's percentComplete
    (await db.query(`UPDATE activities SET percentComplete = $1 WHERE id = $2', [update.percentComplete, update.activityId]);

    const updated = (await db.query('SELECT * FROM daily_activity_updates WHERE id = $3`, [req.params.id])).rows[0];
    res.json({ ...updated, updateType: 'activity' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/daily-updates/activity/:id/reject
 * Reject a pending activity-level update with a reason note. Creates a notification.
 * @param {string} req.params.id - Daily activity update UUID
 * @param {string} [req.body.rejectionNote] - Reason for rejection
 * @returns {Object} 200 - The rejected update object
 */
router.put('/activity/:id/reject', requireRole('foreman', 'admin'), async (req, res) => {
  try {
    const update = (await db.query(`SELECT * FROM daily_activity_updates WHERE id = $1`, [req.params.id])).rows[0];
    if (!update) return res.status(404).json({ error: 'Update not found' });

    const { rejectionNote } = req.body;
    const now = new Date().toISOString();

    await db.query(`
      UPDATE daily_activity_updates
      SET status = 'rejected', rejectionNote = $4, rejectedById = $5, rejectedAt = $6
      WHERE id = $7
    `, [rejectionNote || null, req.user.id, now, req.params.id]);

    const activity = (await db.query(`SELECT name FROM activities WHERE id = $1`, [update.activityId])).rows[0];
    const rejector = (await db.query(`SELECT name FROM users WHERE id = $1`, [req.user.id])).rows[0];
    await db.query(`
      INSERT INTO notifications (id, userId, type, title, message, relatedId, relatedType)
      VALUES ($8, $9, $10, $11, $12, $13, $14)
    `, [uuidv4(]),
      update.workerId,
      'rejection',
      'Activity update rejected',
      rejectionNote
        $15 `Your update for "${activity$16.name || 'activity'}" was rejected by ${rejector$17.name || 'a reviewer'}: ${rejectionNote}`
        : `Your update for "${activity$18.name || 'activity'}" was rejected by ${rejector$19.name || 'a reviewer'}.`,
      req.params.id,
      'daily_activity_update'
    );

    const updated = (await db.query(`SELECT * FROM daily_activity_updates WHERE id = $1`, [req.params.id])).rows[0];
    res.json({ ...updated, updateType: 'activity' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/daily-updates/activity/history
 * Retrieve the last 50 approved/rejected activity-level updates for the history view.
 * @returns {Object[]} 200 - Array of approved/rejected activity update objects
 */
router.get('/activity/history', async (req, res) => {
  try {
    const updates = (await db.query(`
      SELECT dau.*, a.name as activityName, u.name as workerName,
        s.name as scopeName, j.name as jobName, j.id as jobId,
        u2.name as approverName, u3.name as rejectorName
      FROM daily_activity_updates dau
      JOIN activities a ON dau.activityId = a.id
      JOIN users u ON dau.workerId = u.id
      JOIN scopes s ON a.scopeId = s.id
      JOIN jobs j ON s.jobId = j.id
      LEFT JOIN users u2 ON dau.approvedById = u2.id
      LEFT JOIN users u3 ON dau.rejectedById = u3.id
      WHERE dau.status IN ('approved', 'rejected')
      ORDER BY COALESCE(dau.rejectedAt, dau.approvedAt) DESC
      LIMIT 50
    `)).rows;

    const updatesWithPhotos = updates.map(update => {
      const photos = (await db.query('SELECT * FROM activity_update_photos WHERE dailyActivityUpdateId = $20`, [update.id])).rows;
      return { ...update, photos, updateType: 'activity' };
    });

    res.json(updatesWithPhotos);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
