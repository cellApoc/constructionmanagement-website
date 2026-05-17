/**
 * Shared cascade delete helpers for WBS hierarchy cleanup.
 * @module server/helpers/cascadeDelete
 */

const db = require('../db');

/**
 * Delete all children of an activity: tasks, dependencies, photos, daily updates,
 * timesheets, and worker assignments.
 * @param {string} activityId - Activity UUID
 */
function deleteActivityChildren(activityId) {
  const tasks = (await db.query(`SELECT id FROM tasks WHERE activityId = $1`, [activityId])).rows;
  for (const task of tasks) {
    await db.query(`DELETE FROM task_dependencies WHERE taskId = $1 OR predecessorTaskId = $2`, [task.id, task.id]);
    await db.query(`DELETE FROM task_photos WHERE dailyTaskUpdateId IN (SELECT id FROM daily_task_updates WHERE taskId = $1)`, [task.id]);
    await db.query(`DELETE FROM daily_task_updates WHERE taskId = $1`, [task.id]);
  }
  await db.query(`DELETE FROM tasks WHERE activityId = $1`, [activityId]);
  await db.query(`DELETE FROM timesheet_entries WHERE activityId = $1`, [activityId]);
  await db.query(`DELETE FROM worker_assignments WHERE activityId = $1`, [activityId]);
}

module.exports = { deleteActivityChildren };
