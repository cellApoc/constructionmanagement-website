/**
 * @file Alert Rules API — CRUD for configurable budget alert thresholds
 *
 * Supports global defaults (jobId = NULL) and per-job overrides.
 * Global defaults are seeded on first run by the automation engine.
 *
 * Routes:
 *   GET    /api/alert-rules              - List all global rules
 *   GET    /api/alert-rules/job/:jobId   - Get effective rules for a job (global + overrides)
 *   POST   /api/alert-rules              - Create a rule (global or per-job)
 *   PUT    /api/alert-rules/:id          - Update a rule's threshold or enabled state
 *   DELETE /api/alert-rules/:id          - Delete a rule (per-job overrides only)
 *   POST   /api/alert-rules/job/:jobId/override - Create a per-job override from a global rule
 *   POST   /api/alert-rules/check/:jobId - Manually trigger budget alert check for a job
 *
 * @module routes/alertRules
 */

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { auth, requireRole } = require('../middleware/auth');
const { getEffectiveRules, checkBudgetAlerts, DEFAULT_ALERT_RULES } = require('../helpers/automationEngine');

router.use(auth);

/**
 * GET /api/alert-rules
 * List all global alert rules (jobId IS NULL).
 */
router.get('/', requireRole('admin', 'project_manager'), async (req, res) => {
  try {
    const rules = (await db.query(`SELECT * FROM alert_rules WHERE jobId IS NULL ORDER BY ruleType`)).rows;
    res.json(rules);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/alert-rules/job/:jobId
 * Get the effective rules for a specific job (global defaults + per-job overrides merged).
 */
router.get('/job/:jobId', requireRole('admin', 'project_manager', 'foreman'), async (req, res) => {
  try {
    const globalRules = (await db.query(`SELECT * FROM alert_rules WHERE jobId IS NULL ORDER BY ruleType`)).rows;
    const jobRules = (await db.query(`SELECT * FROM alert_rules WHERE jobId = $1 ORDER BY ruleType`, [req.params.jobId])).rows;

    const jobRuleMap = {};
    jobRules.forEach(r => { jobRuleMap[r.ruleType] = r; });

    const effective = globalRules.map(gr => {
      const override = jobRuleMap[gr.ruleType];
      return {
        ...gr,
        ...(override $2 {
          id: override.id,
          threshold: override.threshold,
          enabled: override.enabled,
          isOverride: true,
          globalThreshold: gr.threshold,
          overrideId: override.id,
        } : {
          isOverride: false,
        }),
      };
    });

    res.json({ effective, globalRules, jobOverrides: jobRules });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/alert-rules
 * Create a new alert rule (global if no jobId, per-job if jobId provided).
 */
router.post('/', requireRole('admin'), async (req, res) => {
  try {
    const { jobId, ruleType, threshold, label, enabled } = req.body;
    if (!ruleType || threshold === undefined) {
      return res.status(400).json({ error: 'ruleType and threshold are required' });
    }

    const id = uuidv4();
    await db.query(`
      INSERT INTO alert_rules (id, jobId, ruleType, threshold, label, enabled, createdAt, updatedAt)
      VALUES ($3, $4, $5, $6, $7, $8, NOW(), NOW())
    `, [id, jobId || null, ruleType, threshold, label || null, enabled !== false $9 1 : 0]);

    const rule = await db.query(`SELECT * FROM alert_rules WHERE id = $10`, [id])).rows[0];
    res.status(201).json(rule);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/alert-rules/:id
 * Update a rule's threshold, label, or enabled state.
 */
router.put('/:id', requireRole('admin'), async (req, res) => {
  try {
    const existing = (await db.query(`SELECT * FROM alert_rules WHERE id = $1`, [req.params.id])).rows[0];
    if (!existing) return res.status(404).json({ error: 'Rule not found' });

    const { threshold, label, enabled } = req.body;

    (await db.query(`
      UPDATE alert_rules SET
        threshold = COALESCE($1, threshold),
        label = COALESCE($2, label),
        enabled = COALESCE($3, enabled),
        updatedAt = NOW()
      WHERE id = $4
    `, [
      threshold !== undefined $5 threshold : null,
      label !== undefined $6 label : null,
      enabled !== undefined $7 (enabled $8 1 : 0]) : null,
      req.params.id
    );

    const updated = (await db.query(`SELECT * FROM alert_rules WHERE id = $1`, [req.params.id])).rows[0];
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/alert-rules/:id
 * Delete a rule. Only allows deleting per-job overrides, not global defaults.
 */
router.delete('/:id', requireRole('admin'), async (req, res) => {
  try {
    const rule = (await db.query(`SELECT * FROM alert_rules WHERE id = $1`, [req.params.id])).rows[0];
    if (!rule) return res.status(404).json({ error: 'Rule not found' });
    if (!rule.jobId) return res.status(400).json({ error: 'Cannot delete global default rules. Disable them instead.' });

    (await db.query(`DELETE FROM alert_rules WHERE id = $1`, [req.params.id]);
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/alert-rules/job/:jobId/override
 * Create a per-job override for a global rule.
 */
router.post('/job/:jobId/override', requireRole('admin', 'project_manager'), async (req, res) => {
  try {
    const { ruleType, threshold, enabled } = req.body;
    if (!ruleType || threshold === undefined) {
      return res.status(400).json({ error: 'ruleType and threshold are required' });
    }

    // Check if override already exists
    const existing = (await db.query('SELECT * FROM alert_rules WHERE jobId = $2 AND ruleType = $3`, [req.params.jobId, ruleType])).rows[0];
    if (existing) {
      // Update instead
      (await db.query(`UPDATE alert_rules SET threshold = $1, enabled = $2, updatedAt = datetime(\'now\') WHERE id = $3')
        .run(threshold, enabled !== false $4 1 : 0, existing.id);
      const updated = (await db.query('SELECT * FROM alert_rules WHERE id = $5`, [existing.id])).rows[0];
      return res.json(updated);
    }

    // Get the global rule for context
    const globalRule = (await db.query(`SELECT * FROM alert_rules WHERE jobId IS NULL AND ruleType = $1`, [ruleType])).rows[0];

    const id = uuidv4();
    await db.query(`
      INSERT INTO alert_rules (id, jobId, ruleType, threshold, label, enabled, createdAt, updatedAt)
      VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
    `, [id, req.params.jobId, ruleType, threshold, globalRule?.label || ruleType, enabled !== false ? 1 : 0]);

    const rule = (await db.query(`SELECT * FROM alert_rules WHERE id = $1`, [id])).rows[0];
    res.status(201).json(rule);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/alert-rules/check/:jobId
 * Manually trigger budget alert check for a job. Returns triggered alerts.
 */
router.post('/check/:jobId', requireRole('admin', 'project_manager', 'foreman'), async (req, res) => {
  try {
    const result = checkBudgetAlerts(req.params.jobId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
