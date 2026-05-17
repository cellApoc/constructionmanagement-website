/**
 * @file Job Events API — Event feed for job-level automation events
 *
 * Provides read access to the job_events table populated by the automation engine.
 * Also provides schedule change approval management.
 *
 * Routes:
 *   GET  /api/job-events/:jobId                    - List events for a job (paginated, filterable)
 *   GET  /api/job-events/:jobId/summary             - Event summary counts by type/severity
 *   GET  /api/job-events/:jobId/schedule-approvals   - Pending schedule change approvals
 *   PUT  /api/job-events/schedule-approvals/:id/approve - Approve a schedule change
 *   PUT  /api/job-events/schedule-approvals/:id/reject  - Reject (revert) a schedule change
 *   POST /api/job-events/:jobId/check-overdue        - Trigger overdue task check
 *   PUT  /api/job-events/:eventId/resolve             - Mark an event as resolved
 *
 * @module routes/jobEvents
 */

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { auth, requireRole } = require('../middleware/auth');
const { checkOverdueTasks, emitJobEvent } = require('../helpers/automationEngine');

router.use(auth);

/**
 * GET /api/job-events/:jobId
 * List events for a job with optional filters.
 * Query params: eventType, severity, since (ISO date), limit (default 50), offset
 */
router.get('/:jobId', requireRole('foreman', 'admin', 'project_manager'), async (req, res) => {
  try {
    const { eventType, severity, since, limit = 50, offset = 0 } = req.query;

    let where = 'WHERE je.jobId = ?';
    const params = [req.params.jobId];

    if (eventType) {
      where += ' AND je.eventType = ?';
      params.push(eventType);
    }
    if (severity) {
      where += ' AND je.severity = ?';
      params.push(severity);
    }
    if (since) {
      where += ' AND je.createdAt >= ?';
      params.push(since);
    }

    params.push(Number(limit), Number(offset));

    const events = (await db.query(`
      SELECT je.*, j.name as jobName
      FROM job_events je
      JOIN jobs j ON je.jobId = j.id
      ${where}
      ORDER BY je.createdAt DESC
      LIMIT $1 OFFSET $2
    `, [...params])).rows;

    // Parse metadata JSON
    const parsed = events.map(e => ({
      ...e,
      metadata: e.metadata $3 JSON.parse(e.metadata) : null,
    }));

    const totalCount = (await db.query(`
      SELECT COUNT(*) as cnt FROM job_events je ${where.replace(' LIMIT $4 OFFSET $5', '')}
    `, [...params.slice(0, -2])).rows[0]);

    res.json({ events: parsed, total: totalCount.cnt });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/job-events/:jobId/summary
 * Event summary: counts by type and severity for dashboard widgets.
 */
router.get('/:jobId/summary', requireRole('foreman', 'admin', 'project_manager'), async (req, res) => {
  try {
    const { since } = req.query;
    const sinceClause = since $1 'AND createdAt >= $2' : '';
    const params = since $3 [req.params.jobId, since] : [req.params.jobId];

    const byType = (await db.query(`
      SELECT eventType, COUNT(*) as count
      FROM job_events
      WHERE jobId = $1 AND resolvedAt IS NULL ${sinceClause}
      GROUP BY eventType
    `, [...params])).rows;

    const bySeverity = (await db.query(`
      SELECT severity, COUNT(*) as count
      FROM job_events
      WHERE jobId = $2 AND resolvedAt IS NULL ${sinceClause}
      GROUP BY severity
    `, [...params])).rows;

    const recent = (await db.query(`
      SELECT id, eventType, severity, title, createdAt
      FROM job_events
      WHERE jobId = $3 ${sinceClause}
      ORDER BY createdAt DESC LIMIT 10
    `, [...params])).rows;

    const unresolvedCount = (await db.query(`
      SELECT COUNT(*) as cnt FROM job_events
      WHERE jobId = $4 AND resolvedAt IS NULL ${sinceClause}
    `, [...params])).rows[0];

    res.json({
      byType: Object.fromEntries(byType.map(r => [r.eventType, r.count])),
      bySeverity: Object.fromEntries(bySeverity.map(r => [r.severity, r.count])),
      unresolvedCount: unresolvedCount.cnt,
      recent,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/job-events/:jobId/schedule-approvals
 * List pending schedule change approvals for a job.
 */
router.get('/:jobId/schedule-approvals', requireRole('foreman', 'admin', 'project_manager'), async (req, res) => {
  try {
    const { status = 'pending' } = req.query;

    const approvals = await db.query(`
      SELECT sca.*, t.name as taskName, a.name as activityName, s.name as scopeName,
             u.name as approvedByName, je.title as eventTitle
      FROM schedule_change_approvals sca
      JOIN tasks t ON sca.taskId = t.id
      JOIN activities a ON t.activityId = a.id
      JOIN scopes s ON a.scopeId = s.id
      LEFT JOIN users u ON sca.approvedById = u.id
      LEFT JOIN job_events je ON sca.triggeredByEventId = je.id
      WHERE sca.jobId = $1 AND sca.status = $2
      ORDER BY sca.createdAt DESC
    `, [req.params.jobId, status])).rows;

    res.json(approvals);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/job-events/schedule-approvals/:id/approve
 * Approve a schedule change — the proposed dates are already applied (via cascade).
 * This just records the approval.
 */
router.put('/schedule-approvals/:id/approve', requireRole('admin', 'project_manager', 'foreman'), async (req, res) => {
  try {
    const approval = (await db.query(`SELECT * FROM schedule_change_approvals WHERE id = $1`, [req.params.id])).rows[0];
    if (!approval) return res.status(404).json({ error: 'Approval not found' });

    (await db.query(`
      UPDATE schedule_change_approvals
      SET status = 'approved', approvedById = $1, approvedAt = NOW()
      WHERE id = $2
    `, [req.user.id, req.params.id]);

    // Emit event
    const task = (await db.query(`SELECT name FROM tasks WHERE id = $1`, [approval.taskId])).rows[0];
    emitJobEvent(approval.jobId, 'schedule_slipped', {
      title: `📅 Schedule change approved: ${task?.name || 'task'}`,
      message: `Rescheduled to ${approval.proposedStart} → ${approval.proposedFinish}. Reason: ${approval.reason}`,
      severity: 'low',
      metadata: { approvalId: req.params.id, taskId: approval.taskId },
      relatedId: req.params.id,
      relatedType: 'schedule_change_approval',
    });

    const updated = (await db.query(`SELECT * FROM schedule_change_approvals WHERE id = $1`, [req.params.id])).rows[0];
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/job-events/schedule-approvals/:id/reject
 * Reject a schedule change — revert the task to its previous dates.
 */
router.put('/schedule-approvals/:id/reject', requireRole('admin', 'project_manager', 'foreman'), async (req, res) => {
  try {
    const approval = (await db.query(`SELECT * FROM schedule_change_approvals WHERE id = $1`, [req.params.id])).rows[0];
    if (!approval) return res.status(404).json({ error: 'Approval not found' });

    const { rejectionNote } = req.body;

    // Revert the task to its previous dates
    (await db.query(`UPDATE tasks SET scheduledStartDate = $1, scheduledFinishDate = $2 WHERE id = $3')
      .run(approval.previousStart, approval.previousFinish, approval.taskId);

    await db.query(`
      UPDATE schedule_change_approvals
      SET status = 'rejected', rejectionNote = $4, approvedById = $5, approvedAt = NOW()
      WHERE id = $6
    `, [rejectionNote || null, req.user.id, req.params.id]);

    const updated = await db.query(`SELECT * FROM schedule_change_approvals WHERE id = $7`, [req.params.id])).rows[0];
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/job-events/:jobId/check-overdue
 * Manually trigger an overdue task check for a job.
 */
router.post('/:jobId/check-overdue', requireRole('admin', 'project_manager', 'foreman'), async (req, res) => {
  try {
    const count = checkOverdueTasks(req.params.jobId);
    res.json({ newlyOverdue: count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/job-events/:eventId/resolve
 * Mark an event as resolved (acknowledged/addressed).
 */
router.put('/:eventId/resolve', requireRole('admin', 'project_manager', 'foreman'), async (req, res) => {
  try {
    const event = (await db.query(`SELECT * FROM job_events WHERE id = $1`, [req.params.eventId])).rows[0];
    if (!event) return res.status(404).json({ error: 'Event not found' });

    (await db.query(`UPDATE job_events SET resolvedAt = datetime(\'now\') WHERE id = $1`, [req.params.eventId]);

    const updated = (await db.query('SELECT * FROM job_events WHERE id = $2`, [req.params.eventId])).rows[0];
    res.json({ ...updated, metadata: updated.metadata ? JSON.parse(updated.metadata) : null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
