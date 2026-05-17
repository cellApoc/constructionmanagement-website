/**
 * @file Global search route for finding jobs and tasks by keyword.
 * Searches job name, address, and customerName fields, plus task names.
 * Returns top 5 results for each category. All routes require authentication.
 * @module server/routes/search
 */

const express = require('express');
const db = require('../db');
const { auth } = require('../middleware/auth');

const router = express.Router();
router.use(auth);

/**
 * GET /api/search
 * Search across jobs and tasks using a LIKE query on the given term.
 * @param {string} req.query.q - Search term (minimum 2 characters)
 * @returns {Object} 200 - { jobs: Object[], tasks: Object[] } with up to 5 results each
 * @returns {Object} 200 - Empty arrays if query is too short
 */
router.get('/', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.trim().length < 2) return res.json({ jobs: [], tasks: [] });

    const term = `%${q.trim()}%`;

    const jobs = (await db.query(`
      SELECT id, name, address, status FROM jobs
      WHERE name LIKE $1 OR address LIKE $2 OR customerName LIKE $3
      ORDER BY createdAt DESC LIMIT 5
    `, [term, term, term])).rows;

    const tasks = (await db.query(`
      SELECT t.id, t.name, t.currentPercentComplete, j.id as jobId, j.name as jobName
      FROM tasks t
      JOIN activities a ON t.activityId = a.id
      JOIN scopes s ON a.scopeId = s.id
      JOIN jobs j ON s.jobId = j.id
      WHERE t.name LIKE $1
      ORDER BY j.createdAt DESC LIMIT 5
    `, [term])).rows;

    res.json({ jobs, tasks });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
