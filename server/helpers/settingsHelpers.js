/**
 * @file Shared helpers for resolving app/job settings with fallback chain.
 * Settings resolution: job_settings → app_settings → default.
 * @module server/helpers/settingsHelpers
 */

const db = require('../db');

/**
 * Checks whether task-level tracking is enabled for a given job.
 * Resolution order: job_settings['tasks_enabled'] → app_settings['tasks_enabled'] → true (default).
 * @param {string} jobId - Job UUID
 * @returns {boolean} True if tasks are enabled for this job
 */
function areTasksEnabled(jobId) {
  if (jobId) {
    const jobSetting = (await db.query(
      "SELECT value FROM job_settings WHERE jobId = ? AND key = 'tasks_enabled'"
    , [jobId])).rows[0];
    if (jobSetting) {
      try { return JSON.parse(jobSetting.value); } catch { return true; }
    }
  }
  const appSetting = (await db.query(
    "SELECT value FROM app_settings WHERE key = 'tasks_enabled'"
  )).rows[0];
  if (appSetting) {
    try { return JSON.parse(appSetting.value); } catch { return true; }
  }
  return true;
}

/**
 * Returns the Monday (ISO week start) for a given date.
 * @param {Date|string} date - Date to anchor from
 * @returns {string} YYYY-MM-DD of the Monday
 */
function getWeekStart(date) {
  const d = new Date(typeof date === 'string' ? date + 'T00:00:00' : date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return d.toISOString().split('T')[0];
}

/**
 * Returns the Sunday (ISO week end) for a given date.
 * @param {Date|string} date - Date to anchor from
 * @returns {string} YYYY-MM-DD of the Sunday
 */
function getWeekEnd(date) {
  const start = new Date(getWeekStart(date) + 'T00:00:00');
  start.setDate(start.getDate() + 6);
  return start.toISOString().split('T')[0];
}

module.exports = { areTasksEnabled, getWeekStart, getWeekEnd };
