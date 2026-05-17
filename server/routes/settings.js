/**
 * @file App settings and per-job settings routes.
 * Provides CRUD for global app_settings and per-job job_settings overrides.
 * @module server/routes/settings
 */

const express = require('express');
const router = express.Router();
const db = require('../db');
const { auth, requireRole } = require('../middleware/auth');

router.use(auth);

/**
 * GET /api/settings — Get all app settings as key-value object.
 */
router.get('/', async (req, res) => {
  try {
    const rows = (await db.query(`SELECT key, value FROM app_settings`)).rows;
    const settings = {};
    for (const row of rows) {
      try { settings[row.key] = JSON.parse(row.value); }
      catch { settings[row.key] = row.value; }
    }
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/settings/:key — Update a setting (admin only).
 */
router.put('/:key', requireRole('admin'), async (req, res) => {
  try {
    const { key } = req.params;
    const { value } = req.body;
    if (value === undefined) return res.status(400).json({ error: 'value is required' });

    const stored = typeof value === 'string' ? value : JSON.stringify(value);
    (await db.query(
      "INSERT INTO app_settings (key, value, updatedAt, updatedById) VALUES (?, ?, NOW(), ?) ON CONFLICT(key) DO UPDATE SET value = ?, updatedAt = NOW(), updatedById = ?"
    , [key, stored, req.user.id, stored, req.user.id]);

    res.json({ key, value });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/settings/jobs/:jobId — Get job-level settings.
 */
router.get('/jobs/:jobId', async (req, res) => {
  try {
    const rows = (await db.query(`SELECT key, value FROM job_settings WHERE jobId = $1`, [req.params.jobId])).rows;
    const settings = {};
    for (const row of rows) {
      try { settings[row.key] = JSON.parse(row.value); }
      catch { settings[row.key] = row.value; }
    }
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/settings/jobs/:jobId/:key — Upsert a job setting.
 */
router.put('/jobs/:jobId/:key', async (req, res) => {
  try {
    const { jobId, key } = req.params;
    const { value } = req.body;
    if (value === undefined) return res.status(400).json({ error: 'value is required' });

    const { v4: uuidv4 } = require('uuid');
    const stored = typeof value === 'string' ? value : JSON.stringify(value);
    (await db.query(
      "INSERT INTO job_settings (id, jobId, key, value, updatedAt, updatedById) VALUES (?, ?, ?, ?, NOW(), ?) ON CONFLICT(jobId, key) DO UPDATE SET value = ?, updatedAt = NOW(), updatedById = ?"
    , [uuidv4(]), jobId, key, stored, req.user.id, stored, req.user.id);

    res.json({ jobId, key, value });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/settings/jobs/:jobId/:key — Delete a job setting override.
 */
router.delete('/jobs/:jobId/:key', async (req, res) => {
  try {
    const { jobId, key } = req.params;
    await db.query(`DELETE FROM job_settings WHERE jobId = $1 AND key = $2`, [jobId, key]);
    res.json({ message: 'Setting removed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
