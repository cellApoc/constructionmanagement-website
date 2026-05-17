/**
 * @file Template CRUD routes with nested scope/activity support, duplication, and job application.
 * Templates are reusable scope/activity structures that can be applied to jobs.
 * Uses shared helpers from helpers/templateHelpers.js for fetchTemplateWithNesting()
 * and module-level prepared statements (insertScope, insertActivity).
 * All routes require authentication; mutating routes require PM or Admin role.
 * @module server/routes/templates
 */

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { auth, requireRole } = require('../middleware/auth');
const { insertScope, insertActivity, fetchTemplateWithNesting } = require('../helpers/templateHelpers');

const router = express.Router();

router.use(auth);

/**
 * GET /api/templates
 * List all templates with scope counts and total estimated values.
 */
router.get('/', requireRole('project_manager', 'admin'), async (req, res) => {
  try {
    const templates = (await db.query(`
      SELECT t.*,
        (SELECT COUNT(*) FROM template_scopes WHERE templateId = t.id) AS scopeCount,
        COALESCE((SELECT SUM(estimatedValue) FROM template_scopes WHERE templateId = t.id), 0) AS totalEstimatedValue
      FROM templates t
      ORDER BY t.updatedAt DESC
    `)).rows;
    res.json(templates);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/templates/:id
 * Get a single template with full nested hierarchy (scopes -> activities).
 */
router.get('/:id', requireRole('project_manager', 'admin'), async (req, res) => {
  try {
    const template = fetchTemplateWithNesting(req.params.id);
    if (!template) return res.status(404).json({ error: 'Template not found' });
    res.json(template);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/templates
 * Create a template with nested scopes and activities in a single transaction.
 */
router.post('/', requireRole('project_manager', 'admin'), async (req, res) => {
  try {
    const { name, description, scopes, squareFootage, bedrooms, bathrooms, stories, garageType } = req.body;
    if (!name) return res.status(400).json({ error: 'Template name is required' });

    const templateId = uuidv4();

    const insertTemplate = (await db.query(
      'INSERT INTO templates (id, name, description, createdById, squareFootage, bedrooms, bathrooms, stories, garageType) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );

    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      insertTemplate.run(templateId, name, description || null, req.user.id, squareFootage || null, bedrooms || null, bathrooms || null, stories || null, garageType || null);

      if (Array.isArray(scopes)) {
        scopes.forEach((scope, sIdx) => {
          const scopeId = uuidv4();
          insertScope.run(scopeId, templateId, scope.name, scope.description || null, scope.estimatedValue || 0, scope.sortOrder ?? sIdx);

          if (Array.isArray(scope.activities)) {
            scope.activities.forEach((act, aIdx) => {
              insertActivity.run(uuidv4(), scopeId, act.name, act.estimatedHours || 0, act.sortOrder ?? aIdx);
            });
          }
        });
      }
    
      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }
    res.status(201).json(fetchTemplateWithNesting(templateId));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/templates/:id/duplicate
 * Duplicate a template with all nested scopes and activities.
 */
router.post('/:id/duplicate', requireRole('project_manager', 'admin'), async (req, res) => {
  try {
    const original = fetchTemplateWithNesting(req.params.id);
    if (!original) return res.status(404).json({ error: 'Template not found' });

    const templateId = uuidv4();

    const insertTemplate = (await db.query(
      'INSERT INTO templates (id, name, description, createdById, squareFootage, bedrooms, bathrooms, stories, garageType) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );

    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      insertTemplate.run(templateId, `${original.name} (Copy)`, original.description, req.user.id, original.squareFootage, original.bedrooms, original.bathrooms, original.stories, original.garageType);

      for (const scope of original.scopes) {
        const scopeId = uuidv4();
        insertScope.run(scopeId, templateId, scope.name, scope.description, scope.estimatedValue, scope.sortOrder);

        for (const act of scope.activities) {
          insertActivity.run(uuidv4(), scopeId, act.name, act.estimatedHours, act.sortOrder);
        }
      }
    
      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }
    res.status(201).json(fetchTemplateWithNesting(templateId));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/templates/:id
 * Full replace of template with nested data. Deletes existing children and re-inserts.
 */
router.put('/:id', requireRole('project_manager', 'admin'), async (req, res) => {
  try {
    const existing = (await db.query(`SELECT * FROM templates WHERE id = $1`, [req.params.id])).rows[0];
    if (!existing) return res.status(404).json({ error: 'Template not found' });

    const { name, description, scopes, squareFootage, bedrooms, bathrooms, stories, garageType } = req.body;

    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      (await db.query(`UPDATE templates SET name=$1, description=$2, squareFootage=$3, bedrooms=$4, bathrooms=$5, stories=$6, garageType=$7, updatedAt=datetime(\'now\') WHERE id=$8')
        .run(name $9$10 existing.name, description $11$12 existing.description, squareFootage $13$14 existing.squareFootage, bedrooms $15$16 existing.bedrooms, bathrooms $17$18 existing.bathrooms, stories $19$20 existing.stories, garageType $21$22 existing.garageType, req.params.id);

      // Only replace scopes/activities if scopes were explicitly provided
      if (Array.isArray(scopes)) {
        // Delete existing children
        const existingScopes = (await db.query(`SELECT id FROM template_scopes WHERE templateId = $23`, [req.params.id])).rows;
        for (const scope of existingScopes) {
          (await db.query(`DELETE FROM template_activities WHERE templateScopeId = $24', [scope.id]);
        }
        await db.query(`DELETE FROM template_scopes WHERE templateId = $25`, [req.params.id]);

        // Re-insert scopes and activities
        scopes.forEach((scope, sIdx) => {
          const scopeId = uuidv4();
          insertScope.run(scopeId, req.params.id, scope.name, scope.description || null, scope.estimatedValue || 0, scope.sortOrder $26$27 sIdx);

          if (Array.isArray(scope.activities)) {
            scope.activities.forEach((act, aIdx) => {
              insertActivity.run(uuidv4(), scopeId, act.name, act.estimatedHours || 0, act.sortOrder $28$29 aIdx);
            });
          }
        });
      }
    
      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }
    res.json(fetchTemplateWithNesting(req.params.id));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/templates/:id
 * Cascade delete: template_activities -> template_scopes -> templates.
 */
router.delete('/:id', requireRole('project_manager', 'admin'), async (req, res) => {
  try {
    const existing = await db.query(`SELECT * FROM templates WHERE id = $30`, [req.params.id])).rows[0];
    if (!existing) return res.status(404).json({ error: 'Template not found' });

    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      const scopes = (await db.query(`SELECT id FROM template_scopes WHERE templateId = $1`, [req.params.id])).rows;
      for (const scope of scopes) {
        client_TEMP('DELETE FROM template_activities WHERE templateScopeId = $2`, [scope.id]);
      }
      await db.query(`DELETE FROM template_scopes WHERE templateId = $3`, [req.params.id]);
      await db.query(`DELETE FROM templates WHERE id = $4`, [req.params.id]);
    
      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }
    res.json({ message: 'Template deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/templates/:id/apply/:jobId
 * Apply a template to a job, creating real scopes and activities.
 */
router.post('/:id/apply/:jobId', requireRole('project_manager', 'admin'), async (req, res) => {
  try {
    const template = fetchTemplateWithNesting(req.params.id);
    if (!template) return res.status(404).json({ error: 'Template not found' });

    const job = (await db.query('SELECT * FROM jobs WHERE id = $5`, [req.params.jobId])).rows[0];
    if (!job) return res.status(404).json({ error: 'Job not found' });

    // Get max existing sortOrder for the job's scopes
    const maxSort = (await db.query(`SELECT COALESCE(MAX(sortOrder), -1) AS maxSort FROM scopes WHERE jobId = $1`, [req.params.jobId])).rows[0];
    let sortOffset = (maxSort?.maxSort ?? -1) + 1;

    const overrides = req.body.scopes || [];
    const overrideMap = {};
    for (const o of overrides) {
      overrideMap[o.templateScopeId] = o;
    }

    const createdScopes = [];

    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      for (const ts of template.scopes) {
        const override = overrideMap[ts.id] || {};
        const scopeId = uuidv4();
        const scopeName = override.name || ts.name;
        const scopeDesc = override.description ?? ts.description;
        const scopeValue = override.estimatedValue ?? ts.estimatedValue;

        client_TEMP(
          'INSERT INTO scopes (id, jobId, name, description, estimatedValue, sortOrder) VALUES (?, ?, ?, ?, ?, ?)'
        , [scopeId, req.params.jobId, scopeName, scopeDesc, scopeValue, sortOffset++]);

        const actOverrides = {};
        if (Array.isArray(override.activities)) {
          for (const ao of override.activities) {
            actOverrides[ao.templateActivityId] = ao;
          }
        }

        const createdActivities = [];
        let actSort = 0;
        for (const ta of ts.activities) {
          const actOverride = actOverrides[ta.id] || {};
          const actId = uuidv4();
          const actName = actOverride.name || ta.name;
          const actHours = actOverride.estimatedHours ?? ta.estimatedHours;

          client_TEMP(
            'INSERT INTO activities (id, scopeId, name, estimatedHours, actualHours, sortOrder) VALUES (?, ?, ?, ?, 0, ?)'
          , [actId, scopeId, actName, actHours, actSort++]);

          createdActivities.push({ id: actId, name: actName, estimatedHours: actHours, sortOrder: actSort - 1 });
        }

        createdScopes.push({
          id: scopeId,
          name: scopeName,
          description: scopeDesc,
          estimatedValue: scopeValue,
          activities: createdActivities,
        });
      }
    
      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }

    res.status(201).json({ message: 'Template applied', scopes: createdScopes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
