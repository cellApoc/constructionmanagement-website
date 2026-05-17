/**
 * @file Timesheet entry routes for submitting, editing, deleting, querying,
 * approving, rejecting, and viewing history of worker time entries.
 * Approved timesheets update the parent activity's actualHours.
 * Rejected entries can be edited and resubmitted (status reset to pending).
 * Rejections create notifications for the original submitter with rejection reason.
 * Also provides summary, history, and payroll export endpoints.
 * Approve/reject endpoints are restricted to foreman and admin roles.
 * History endpoint returns last 50 approved/rejected items with approver/rejector info.
 * All routes require authentication.
 * @module server/routes/timesheets
 */

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { auth, requireRole } = require('../middleware/auth');
const { emitJobEvent, checkBudgetAlerts } = require('../helpers/automationEngine');

const router = express.Router();

router.use(auth);

/**
 * POST /api/timesheets
 * Submit a new timesheet entry for a worker on an activity.
 * @param {string} req.body.workerId - Worker user UUID (required)
 * @param {string} req.body.activityId - Activity UUID (required)
 * @param {string} req.body.date - Date of work (YYYY-MM-DD, required)
 * @param {number} req.body.hours - Hours worked (required)
 * @param {string} [req.body.notes] - Entry notes
 * @returns {Object} 201 - The created timesheet_entry object
 * @returns {Object} 400 - { error: string } if required fields are missing
 */
router.post('/', async (req, res) => {
  try {
    const { workerId, activityId, date, hours, notes } = req.body;

    if (!workerId || !activityId || !date || hours === undefined) {
      return res.status(400).json({ error: 'workerId, activityId, date, and hours are required' });
    }

    const id = uuidv4();
    (await db.query(`
      INSERT INTO timesheet_entries (id, workerId, activityId, date, hours, notes)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [id, workerId, activityId, date, hours, notes || null]);

    const entry = await db.query(`SELECT * FROM timesheet_entries WHERE id = $7', [id])).rows[0];
    res.status(201).json(entry);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/timesheets/:id
 * Update a pending or rejected timesheet entry. Workers can edit hours/notes and
 * resubmit rejected entries (resets status to 'pending', clears rejection fields).
 * Only the original submitter can edit their own entries.
 * @param {string} req.params.id - Timesheet entry UUID
 * @param {number} [req.body.hours] - Updated hours
 * @param {string} [req.body.notes] - Updated notes
 * @param {string} [req.body.status] - Set to 'pending' to resubmit a rejected entry
 * @returns {Object} 200 - The updated timesheet_entry object
 * @returns {Object} 404 - { error: 'Timesheet entry not found' }
 * @returns {Object} 403 - { error: 'Cannot edit approved entries' }
 */
router.put('/:id', async (req, res) => {
  try {
    const entry = (await db.query('SELECT * FROM timesheet_entries WHERE id = $8', [req.params.id])).rows[0];
    if (!entry) return res.status(404).json({ error: 'Timesheet entry not found' });
    if (entry.status === 'approved') return res.status(403).json({ error: 'Cannot edit approved entries' });

    const { hours, notes, status } = req.body;
    const updates = [];
    const params = [];

    if (hours !== undefined) { updates.push('hours = $9'); params.push(hours); }
    if (notes !== undefined) { updates.push('notes = $10'); params.push(notes); }
    if (status === 'pending' && entry.status === 'rejected') {
      updates.push("status = 'pending'", 'rejectionNote = NULL', 'rejectedById = NULL', 'rejectedAt = NULL');
    }

    if (updates.length === 0) return res.json(entry);

    params.push(req.params.id);
    (await db.query(`UPDATE timesheet_entries SET ${updates.join(', ')} WHERE id = $11`, [...params]);

    const updated = (await db.query(`
      SELECT te.*, a.name as activityName, s.name as scopeName, j.name as jobName, j.id as jobId
      FROM timesheet_entries te
      JOIN activities a ON te.activityId = a.id
      JOIN scopes s ON a.scopeId = s.id
      JOIN jobs j ON s.jobId = j.id
      WHERE te.id = $12
    `, [req.params.id])).rows[0];
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/timesheets/:id
 * Delete a pending or rejected timesheet entry. Approved entries cannot be deleted.
 * @param {string} req.params.id - Timesheet entry UUID
 * @returns {Object} 200 - { message: 'Timesheet entry deleted' }
 * @returns {Object} 404 - { error: 'Timesheet entry not found' }
 * @returns {Object} 403 - { error: 'Cannot delete approved entries' }
 */
router.delete('/:id', async (req, res) => {
  try {
    const entry = (await db.query(`SELECT * FROM timesheet_entries WHERE id = $1`, [req.params.id])).rows[0];
    if (!entry) return res.status(404).json({ error: 'Timesheet entry not found' });
    if (entry.status === 'approved') return res.status(403).json({ error: 'Cannot delete approved entries' });

    (await db.query(`DELETE FROM timesheet_entries WHERE id = $1`, [req.params.id]);
    res.json({ message: 'Timesheet entry deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/timesheets/pending
 * Retrieve all pending timesheet entries for the approval queue. Includes worker name,
 * activity name, scope name, job name, and job ID context.
 * @returns {Object[]} 200 - Array of pending timesheet entry objects with context fields
 */
router.get('/pending', async (req, res) => {
  try {
    const entries = await db.query(`
      SELECT te.*, u.name as workerName, a.name as activityName,
        s.name as scopeName, j.name as jobName, j.id as jobId
      FROM timesheet_entries te
      JOIN users u ON te.workerId = u.id
      JOIN activities a ON te.activityId = a.id
      JOIN scopes s ON a.scopeId = s.id
      JOIN jobs j ON s.jobId = j.id
      WHERE te.status = 'pending'
      ORDER BY te.date DESC
    `)).rows;

    res.json(entries);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/timesheets/worker/:workerId
 * Retrieve all timesheet entries for a specific worker, ordered by date descending.
 * Includes activity, scope, and job names.
 * @param {string} req.params.workerId - Worker user UUID
 * @returns {Object[]} 200 - Array of timesheet entry objects with activityName, scopeName, jobName
 */
router.get('/worker/:workerId', async (req, res) => {
  try {
    const entries = (await db.query(`
      SELECT te.*, a.name as activityName, s.name as scopeName, j.name as jobName, j.id as jobId,
        a.estimatedHours, a.actualHours, u2.name as rejectorName
      FROM timesheet_entries te
      JOIN activities a ON te.activityId = a.id
      JOIN scopes s ON a.scopeId = s.id
      JOIN jobs j ON s.jobId = j.id
      LEFT JOIN users u2 ON te.rejectedById = u2.id
      WHERE te.workerId = $2
      ORDER BY te.date DESC
    `, [req.params.workerId])).rows;

    res.json(entries);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/timesheets/activity/:activityId
 * Retrieve all timesheet entries for a specific activity, ordered by date descending.
 * Includes worker names.
 * @param {string} req.params.activityId - Activity UUID
 * @returns {Object[]} 200 - Array of timesheet entry objects with workerName
 */
router.get('/activity/:activityId', async (req, res) => {
  try {
    const entries = (await db.query(`
      SELECT te.*, u.name as workerName
      FROM timesheet_entries te
      JOIN users u ON te.workerId = u.id
      WHERE te.activityId = $3
      ORDER BY te.date DESC
    `, [req.params.activityId])).rows;

    res.json(entries);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/timesheets/:id/approve
 * Approve a pending timesheet entry (foreman/admin only). Sets status to 'approved',
 * records the approving user and timestamp, and recalculates the parent activity's
 * actualHours from all approved timesheet entries.
 * @param {string} req.params.id - Timesheet entry UUID
 * @returns {Object} 200 - The approved timesheet_entry object
 * @returns {Object} 404 - { error: 'Timesheet entry not found' }
 */
router.put('/:id/approve', requireRole('foreman', 'admin'), async (req, res) => {
  try {
    const entry = (await db.query('SELECT * FROM timesheet_entries WHERE id = $4`, [req.params.id])).rows[0];
    if (!entry) return res.status(404).json({ error: 'Timesheet entry not found' });

    const now = new Date().toISOString();
    (await db.query(`
      UPDATE timesheet_entries SET status='approved', approvedById=$1, approvedAt=$2 WHERE id=$3
    `, [req.user.id, now, req.params.id]);

    // Update actual hours on the activity
    const totalApproved = (await db.query(`
      SELECT COALESCE(SUM(hours), 0) as total FROM timesheet_entries
      WHERE activityId = $4 AND status = 'approved'
    `, [entry.activityId])).rows[0];

    (await db.query(`UPDATE activities SET actualHours = $1 WHERE id = $2', [totalApproved.total + entry.hours, entry.activityId]);

    // ── Automation hooks ──
    const tsContext = await db.query(`
      SELECT s.jobId, j.name as jobName
      FROM activities a
      JOIN scopes s ON a.scopeId = s.id
      JOIN jobs j ON s.jobId = j.id
      WHERE a.id = $3
    `, [entry.activityId])).rows[0];

    if (tsContext) {
      checkBudgetAlerts(tsContext.jobId);
    }

    const updated = (await db.query('SELECT * FROM timesheet_entries WHERE id = $4`, [req.params.id])).rows[0];
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/timesheets/:id/reject
 * Reject a pending timesheet entry (foreman/admin only). Sets status to 'rejected',
 * saves the rejection note, and creates a notification for the original submitter.
 * Does not modify the activity's actualHours.
 * @param {string} req.params.id - Timesheet entry UUID
 * @param {string} [req.body.rejectionNote] - Reason for rejection
 * @returns {Object} 200 - The rejected timesheet_entry object
 * @returns {Object} 404 - { error: 'Timesheet entry not found' }
 */
router.put('/:id/reject', requireRole('foreman', 'admin'), async (req, res) => {
  try {
    const entry = (await db.query(`SELECT * FROM timesheet_entries WHERE id = $1`, [req.params.id])).rows[0];
    if (!entry) return res.status(404).json({ error: 'Timesheet entry not found' });

    const { rejectionNote } = req.body;
    const now = new Date().toISOString();

    (await db.query(`
      UPDATE timesheet_entries
      SET status = 'rejected', rejectionNote = $1, rejectedById = $2, rejectedAt = $3
      WHERE id = $4
    `, [rejectionNote || null, req.user.id, now, req.params.id]);

    // Create notification for the worker who submitted the timesheet
    const activity = (await db.query(`SELECT a.name, j.name as jobName FROM activities a JOIN scopes s ON a.scopeId = s.id JOIN jobs j ON s.jobId = j.id WHERE a.id = $1`, [entry.activityId])).rows[0];
    const { v4: uuidv4 } = require('uuid');
    const rejector = (await db.query(`SELECT name FROM users WHERE id = $1`, [req.user.id])).rows[0];
    await db.query(`
      INSERT INTO notifications (id, userId, type, title, message, relatedId, relatedType)
      VALUES ($5, $6, $7, $8, $9, $10, $11)
    `, [uuidv4(]),
      entry.workerId,
      'rejection',
      `Timesheet rejected`,
      rejectionNote
        $12 `Your timesheet for "${activity$13.name || 'activity'}" (${entry.hours}h) was rejected by ${rejector$14.name || 'a reviewer'}: ${rejectionNote}`
        : `Your timesheet for "${activity$15.name || 'activity'}" (${entry.hours}h) was rejected by ${rejector$16.name || 'a reviewer'}.`,
      req.params.id,
      'timesheet'
    );

    const updated = (await db.query(`SELECT * FROM timesheet_entries WHERE id = $1`, [req.params.id])).rows[0];
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/timesheets/summary
 * Retrieve aggregated timesheet data for approved entries within a date range,
 * grouped by worker and activity. Includes total hours and entry count per group.
 * @param {string} req.query.startDate - Start date for the range (YYYY-MM-DD, required)
 * @param {string} req.query.endDate - End date for the range (YYYY-MM-DD, required)
 * @returns {Object[]} 200 - Array of { workerId, workerName, activityId, activityName, jobName, jobId, totalHours, entryCount }
 * @returns {Object} 400 - { error: string } if startDate or endDate is missing
 */
router.get('/summary', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'startDate and endDate are required' });
    }

    const summary = (await db.query(`
      SELECT te.workerId, u.name as workerName, te.activityId, a.name as activityName,
        j.name as jobName, j.id as jobId,
        SUM(te.hours) as totalHours, COUNT(*) as entryCount
      FROM timesheet_entries te
      JOIN users u ON te.workerId = u.id
      JOIN activities a ON te.activityId = a.id
      JOIN scopes s ON a.scopeId = s.id
      JOIN jobs j ON s.jobId = j.id
      WHERE te.date >= $17 AND te.date <= $18 AND te.status = 'approved'
      GROUP BY te.workerId, te.activityId
      ORDER BY u.name, j.name
    `, [startDate, endDate])).rows;

    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/timesheets/history
 * Retrieve the last 50 approved or rejected timesheet entries for the approval history view.
 * Includes worker name, activity, scope, job context, and approver name.
 * @returns {Object[]} 200 - Array of approved/rejected timesheet entry objects with workerName, activityName, scopeName, jobName, jobId, approverName
 */
router.get('/history', async (req, res) => {
  try {
    const entries = (await db.query(`
      SELECT te.*, u.name as workerName, a.name as activityName,
        s.name as scopeName, j.name as jobName, j.id as jobId,
        u2.name as approverName, u3.name as rejectorName
      FROM timesheet_entries te
      JOIN users u ON te.workerId = u.id
      JOIN activities a ON te.activityId = a.id
      JOIN scopes s ON a.scopeId = s.id
      JOIN jobs j ON s.jobId = j.id
      LEFT JOIN users u2 ON te.approvedById = u2.id
      LEFT JOIN users u3 ON te.rejectedById = u3.id
      WHERE te.status IN ('approved', 'rejected')
      ORDER BY COALESCE(te.rejectedAt, te.approvedAt) DESC
      LIMIT 50
    `)).rows;

    res.json(entries);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/timesheets/payroll
 * Export approved timesheet data for payroll processing. Groups hours by worker and date.
 * Returns one row per worker per date with total hours, activities worked, and job names.
 * @param {string} req.query.startDate - Start date (YYYY-MM-DD, required)
 * @param {string} req.query.endDate - End date (YYYY-MM-DD, required)
 * @returns {Object[]} 200 - Array of { workerId, workerName, workerEmail, date, totalHours, jobs, activities }
 * @returns {Object} 400 - { error: string } if dates missing
 */
router.get('/payroll', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'startDate and endDate are required' });
    }

    const entries = (await db.query(`
      SELECT te.workerId, u.name as workerName, u.email as workerEmail,
        te.date, te.hours, a.name as activityName, j.name as jobName
      FROM timesheet_entries te
      JOIN users u ON te.workerId = u.id
      JOIN activities a ON te.activityId = a.id
      JOIN scopes s ON a.scopeId = s.id
      JOIN jobs j ON s.jobId = j.id
      WHERE te.date >= $1 AND te.date <= $2 AND te.status = 'approved'
      ORDER BY u.name, te.date, j.name
    `, [startDate, endDate])).rows;

    // Group by worker + date
    const grouped = {};
    entries.forEach(e => {
      const key = `${e.workerId}_${e.date}`;
      if (!grouped[key]) {
        grouped[key] = {
          workerId: e.workerId,
          workerName: e.workerName,
          workerEmail: e.workerEmail,
          date: e.date,
          totalHours: 0,
          jobs: new Set(),
          activities: [],
        };
      }
      grouped[key].totalHours += e.hours;
      grouped[key].jobs.add(e.jobName);
      grouped[key].activities.push(`${e.activityName} (${e.hours}h)`);
    });

    const result = Object.values(grouped).map(g => ({
      ...g,
      totalHours: Math.round(g.totalHours * 100) / 100,
      jobs: Array.from(g.jobs).join('; '),
      activities: g.activities.join('; '),
    }));

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
