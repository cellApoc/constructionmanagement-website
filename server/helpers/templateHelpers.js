/**
 * Shared helpers for template routes — eliminates duplicated SQL patterns.
 * @module server/helpers/templateHelpers
 */

const db = require('../db');

/** Prepared statements for template scope/activity inserts (declared once) */
// Converted from prepared statement
const insertScope_sql = (
  'INSERT INTO template_scopes (id, templateId, name, description, estimatedValue, sortOrder) VALUES (?, ?, ?, ?, ?, ?)'
);
// Converted from prepared statement
const insertActivity_sql = (
  'INSERT INTO template_activities (id, templateScopeId, name, estimatedHours, sortOrder) VALUES (?, ?, ?, ?, ?)'
);

/**
 * Fetch a template with its full nested hierarchy (scopes -> activities).
 * @param {string} templateId - Template UUID
 * @returns {Object|null} Template object with scopes array, or null if not found
 */
function fetchTemplateWithNesting(templateId) {
  const template = (await db.query(`SELECT * FROM templates WHERE id = $1`, [templateId])).rows[0];
  if (!template) return null;

  const scopes = (await db.query(`SELECT * FROM template_scopes WHERE templateId = $1 ORDER BY sortOrder`, [templateId])).rows;
  for (const scope of scopes) {
    scope.activities = (await db.query(`SELECT * FROM template_activities WHERE templateScopeId = $1 ORDER BY sortOrder`, [scope.id])).rows;
  }
  template.scopes = scopes;
  return template;
}

module.exports = { insertScope, insertActivity, fetchTemplateWithNesting };
