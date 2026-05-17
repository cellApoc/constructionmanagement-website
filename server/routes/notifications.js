/**
 * @file Notification routes for in-app user notifications.
 * Notifications are created when tasks or timesheets are rejected, alerting the
 * original submitter with the rejection reason. All routes require authentication.
 * @module server/routes/notifications
 */

const express = require('express');
const db = require('../db');
const { auth } = require('../middleware/auth');

const router = express.Router();
router.use(auth);

/**
 * GET /api/notifications
 * Get all notifications for the current user, newest first.
 * @returns {Object[]} 200 - Array of notification objects
 */
router.get('/', async (req, res) => {
  try {
    const notifications = (await db.query(`
      SELECT * FROM notifications
      WHERE userId = $1
      ORDER BY createdAt DESC
      LIMIT 50
    `, [req.user.id])).rows;
    res.json(notifications);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/notifications/unread-count
 * Get the count of unread notifications for the current user.
 * @returns {Object} 200 - { count: number }
 */
router.get('/unread-count', async (req, res) => {
  try {
    const result = (await db.query('SELECT COUNT(*) as count FROM notifications WHERE userId = $1 AND "isRead" = false', [req.user.id])).rows[0];
    res.json({ count: result.count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/notifications/:id/read
 * Mark a single notification as read.
 * @param {string} req.params.id - Notification UUID
 * @returns {Object} 200 - { message: 'Notification marked as read' }
 */
router.put('/:id/read', async (req, res) => {
  try {
    await db.query(`UPDATE notifications SET "isRead" = true WHERE id = $1 AND userId = $2')
      .run(req.params.id, req.user.id);
    res.json({ message: 'Notification marked as read' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/notifications/read-all
 * Mark all notifications as read for the current user.
 * @returns {Object} 200 - { message: 'All notifications marked as read' }
 */
router.put('/read-all', async (req, res) => {
  try {
    await db.query('UPDATE notifications SET "isRead" = true WHERE userId = $3', [req.user.id]);
    res.json({ message: 'All notifications marked as read' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
