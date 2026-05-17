/**
 * @file Scope CRUD routes with cascading delete support.
 * Scopes are the top tier of the job work breakdown structure (Scope -> Activity -> Task).
 * Cascade deletes use shared deleteActivityChildren() helper from helpers/cascadeDelete.js.
 * All routes require authentication.
 * @module server/routes/scopes
 */

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { auth } = require('../middleware/auth');
const { deleteActivityChildren } = require('../helpers/cascadeDelete');

const router = express.Router();

router.use(auth);

/**
 * POST /api/scopes
 * Create a new scope under a job.
 * @param {string} req.body.jobId - Parent job UUID (required)
 * @param {string} req.body.name - Scope name (required)
 * @param {string} [req.body.description] - Scope description
 * @param {number} [req.body.estimatedValue] - Estimated dollar value, defaults to 0
 * @param {number} [req.body.sortOrder] - Display order within the job, defaults to 0
 * @returns {Object} 201 - The created scope object
 * @returns {Object} 400 - { error: string } if jobId or name is missing
 * @returns {Object} 404 - { error: 'Job not found' }
 */
router.post('/', async (req, res) => {
  try {
    const { jobId, name, description, estimatedValue, sortOrder } = req.body;

    if (!jobId || !name) return res.status(400).json({ error: 'jobId and name are required' });

    const job = (await db.query(`SELECT id FROM jobs WHERE id = $1`, [jobId])).rows[0];
    if (!job) return res.status(404).json({ error: 'Job not found' });

    const id = uuidv4();
    await db.query('INSERT INTO scopes (id, jobId, name, description, estimatedValue, sortOrder) VALUES ($1, $2, $3, $4, $5, $6)', [id, jobId, name, description || null, estimatedValue || 0, sortOrder || 0]);

    const scope = (await db.query(`SELECT * FROM scopes WHERE id = $1`, [id])).rows[0];
    res.status(201).json(scope);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/scopes/:id
 * Update an existing scope. Fields not provided retain their current values.
 * @param {string} req.params.id - Scope UUID
 * @param {string} [req.body.name] - Scope name
 * @param {string} [req.body.description] - Scope description
 * @param {number} [req.body.estimatedValue] - Estimated dollar value
 * @param {number} [req.body.sortOrder] - Display order
 * @returns {Object} 200 - The updated scope object
 * @returns {Object} 404 - { error: 'Scope not found' }
 */
router.put('/:id', async (req, res) => {
  try {
    const existing = (await db.query(`SELECT * FROM scopes WHERE id = $1`, [req.params.id])).rows[0];
    if (!existing) return res.status(404).json({ error: 'Scope not found' });

    const { name, description, estimatedValue, sortOrder } = req.body;

    await db.query('UPDATE scopes SET name=$1, description=$2, estimatedValue=$3, sortOrder=$4 WHERE id=$5', [
      name ?? existing.name,
      description ?? existing.description,
      estimatedValue ?? existing.estimatedValue,
      sortOrder ?? existing.sortOrder,
      req.params.id
    ]);

    const scope = (await db.query(`SELECT * FROM scopes WHERE id = $1`, [req.params.id])).rows[0];
    res.json(scope);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/scopes/:id
 * Delete a scope and cascade-delete all children: activities, tasks, task dependencies,
 * daily task updates, task photos, timesheet entries, and worker assignments.
 * @param {string} req.params.id - Scope UUID
 * @returns {Object} 200 - { message: 'Scope and all children deleted' }
 * @returns {Object} 404 - { error: 'Scope not found' }
 */
router.delete('/:id', async (req, res) => {
  try {
    const existing = (await db.query(`SELECT * FROM scopes WHERE id = $1`, [req.params.id])).rows[0];
    if (!existing) return res.status(404).json({ error: 'Scope not found' });

    const activities = (await db.query(`SELECT id FROM activities WHERE scopeId = $1`, [req.params.id])).rows;
    for (const activity of activities) {
      deleteActivityChildren(activity.id);
    }
    await db.query(`DELETE FROM activities WHERE scopeId = $1`, [req.params.id]);
    await db.query(`DELETE FROM scopes WHERE id = $1`, [req.params.id]);

    res.json({ message: 'Scope and all children deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
