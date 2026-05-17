/**
 * @file Automation Engine — Scheduling Cascade, Event-Driven Notifications, Budget Alerts
 *
 * Three interconnected automation systems:
 *
 * 1. SCHEDULING CASCADE — When a task's finish date slips, automatically
 *    ripple the delay through all dependent tasks. Creates approval items
 *    for impacted schedule changes.
 *
 * 2. EVENT-DRIVEN NOTIFICATIONS — Fire in-app notifications on:
 *    - Task status changes (complete, overdue, approved, rejected)
 *    - Schedule changes (task delayed, milestone missed, cascade triggered)
 *    - Budget thresholds crossed (configurable per-job or global)
 *    - Change orders submitted/approved/rejected
 *    - Scope completion
 *
 * 3. BUDGET ALERT RULES — Configurable thresholds (global + per-job overrides)
 *    that check on every financial event and generate persistent alerts.
 *
 * All functions are synchronous (better-sqlite3) and designed to be called
 * from within existing route handlers after the primary operation succeeds.
 *
 * @module helpers/automationEngine
 */

const { v4: uuidv4 } = require('uuid');
const db = require('../db');

// ════════════════════════════════════════════════════════════════
// 1. SCHEDULING CASCADE
// ════════════════════════════════════════════════════════════════

/**
 * Add days to a YYYY-MM-DD date string.
 * @param {string} dateStr - Date in YYYY-MM-DD format
 * @param {number} days - Number of days to add (can be negative)
 * @returns {string} New date in YYYY-MM-DD format
 */
function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T12:00:00Z'); // noon UTC to avoid DST issues
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split('T')[0];
}

/**
 * Compute the delta in days between two YYYY-MM-DD dates.
 * @param {string} dateA
 * @param {string} dateB
 * @returns {number} dateB - dateA in days
 */
function daysBetween(dateA, dateB) {
  const a = new Date(dateA + 'T12:00:00Z');
  const b = new Date(dateB + 'T12:00:00Z');
  return Math.round((b - a) / 86400000);
}

/**
 * Cascade a schedule slip through all downstream dependent tasks.
 *
 * When a task's finish date changes, all tasks that depend on it (FS = Finish-to-Start)
 * are shifted forward by the delta. This cascades recursively through the entire
 * dependency chain.
 *
 * Also creates:
 * - A job_event for every shifted task
 * - Notifications for the job's foreman and all admins/PMs
 * - Schedule change approval records for impacted tasks
 *
 * @param {string} taskId - The task whose date just changed
 * @param {string} newFinishDate - New finish date (YYYY-MM-DD)
 * @param {string} triggeredByUserId - User who caused the change
 * @returns {{ shifted: Array<{taskId, taskName, oldStart, oldFinish, newStart, newFinish, delta}>, totalShifted: number }}
 */
function cascadeSchedule(taskId, newFinishDate, triggeredByUserId) {
  const task = (await db.query(`SELECT * FROM tasks WHERE id = $1`, [taskId])).rows[0];
  if (!task || !task.scheduledFinishDate || !newFinishDate) return { shifted: [], totalShifted: 0 };

  const oldFinish = task.scheduledFinishDate;
  const delta = daysBetween(oldFinish, newFinishDate);
  if (delta <= 0) return { shifted: [], totalShifted: 0 }; // Only cascade delays, not advances

  // Get the job context for this task
  const context = (await db.query(`
    SELECT j.id as jobId, j.name as jobName, j.foremanId,
           s.name as scopeName, a.name as activityName
    FROM tasks t
    JOIN activities a ON t.activityId = a.id
    JOIN scopes s ON a.scopeId = s.id
    JOIN jobs j ON s.jobId = j.id
    WHERE t.id = $1
  `, [taskId])).rows[0];

  if (!context) return { shifted: [], totalShifted: 0 };

  // Build full dependency graph for this job
  const allDeps = (await db.query(`
    SELECT td.taskId, td.predecessorTaskId
    FROM task_dependencies td
    JOIN tasks t ON td.taskId = t.id
    JOIN activities a ON t.activityId = a.id
    JOIN scopes s ON a.scopeId = s.id
    WHERE s.jobId = $1
  `, [context.jobId])).rows;

  // Map: predecessorId -> [dependentTaskIds]
  const downstreamMap = {};
  allDeps.forEach(d => {
    if (!downstreamMap[d.predecessorTaskId]) downstreamMap[d.predecessorTaskId] = [];
    downstreamMap[d.predecessorTaskId].push(d.taskId);
  });

  // BFS to find all downstream tasks and shift them
  const shifted = [];
  const visited = new Set();
  const queue = [taskId];
  visited.add(taskId);

  const updateStmt = (await db.query(`UPDATE tasks SET scheduledStartDate=$2, scheduledFinishDate=$3 WHERE id=$4');

  const client = await db.getClient();
    try {
      await client.query('BEGIN');

    while (queue.length > 0) {
      const currentId = queue.shift();
      const dependents = downstreamMap[currentId] || [];

      for (const depTaskId of dependents) {
        if (visited.has(depTaskId)) continue;
        visited.add(depTaskId);

        const depTask = (await client.query('SELECT * FROM tasks WHERE id = $5', [depTaskId])).rows[0];
        if (!depTask || !depTask.scheduledStartDate || !depTask.scheduledFinishDate) continue;

        // Get the latest finish date among all predecessors of this task
        const predecessors = allDeps.filter(d => d.taskId === depTaskId).map(d => d.predecessorTaskId);
        let latestPredFinish = null;
        for (const predId of predecessors) {
          const pred = (await client.query('SELECT scheduledFinishDate FROM tasks WHERE id = $6', [predId])).rows[0];
          if (pred$7.scheduledFinishDate && (!latestPredFinish || pred.scheduledFinishDate > latestPredFinish)) {
            latestPredFinish = pred.scheduledFinishDate;
          }
        }

        if (!latestPredFinish) continue;

        // New start = day after latest predecessor finishes
        const newStart = addDays(latestPredFinish, 1);
        const taskDuration = daysBetween(depTask.scheduledStartDate, depTask.scheduledFinishDate);
        const newFinish = addDays(newStart, taskDuration);

        // Only shift if actually delayed
        if (newStart <= depTask.scheduledStartDate) continue;

        const shiftDelta = daysBetween(depTask.scheduledStartDate, newStart);

        // Record the shift
        shifted.push({
          taskId: depTaskId,
          taskName: depTask.name,
          oldStart: depTask.scheduledStartDate,
          oldFinish: depTask.scheduledFinishDate,
          newStart,
          newFinish,
          delta: shiftDelta,
        });

        // Apply the shift
        await db.query(updateStmt_sql, [newStart, newFinish, depTaskId]);

        // Continue cascade through this task's dependents
        queue.push(depTaskId);
      }
    }

    // Generate events and notifications for all shifted tasks
    if (shifted.length > 0) {
      // Create a single cascade event on the job
      const eventId = uuidv4();
      await db.query(`
        INSERT INTO job_events (id, jobId, eventType, severity, title, message, metadata, createdAt)
        VALUES ($8, $9, $10, $11, $12, $13, $14, NOW())
      `, [eventId,
        context.jobId,
        'schedule_cascade',
        shifted.length > 5 $15 'high' : 'medium',
        `Schedule cascade: ${shifted.length} tasks shifted`,
        `"${task.name}" was delayed by ${delta} day(s]), causing ${shifted.length} downstream task(s) to shift. ` +
        `Latest new finish: ${shifted[shifted.length - 1].newFinish}.`,
        JSON.stringify({
          triggerTaskId: taskId,
          triggerTaskName: task.name,
          originalFinish: oldFinish,
          newFinish: newFinishDate,
          deltaDays: delta,
          shiftedTasks: shifted.map(s => ({ id: s.taskId, name: s.taskName, newStart: s.newStart, newFinish: s.newFinish })),
        })
      );

      // Create schedule_change_approval records for impacted tasks
      const approvalStmt = await db.query(`
        INSERT INTO schedule_change_approvals (id, jobId, taskId, previousStart, previousFinish, proposedStart, proposedFinish, reason, status, triggeredByEventId, createdAt)
        VALUES ($16, $17, $18, $19, $20, $21, $22, $23, 'pending', $24, NOW())
      `);
      for (const s of shifted) {
        await db.query(approvalStmt_sql, [uuidv4(]), context.jobId, s.taskId,
          s.oldStart, s.oldFinish, s.newStart, s.newFinish,
          `Auto-cascaded from "${task.name}" delay (+${delta}d)`,
          eventId
        );
      }

      // Notify foreman, PMs, and admins
      const recipients = client_TEMP(`
        SELECT id FROM users WHERE id = $25 OR role IN ('admin', 'project_manager')
      `, [context.foremanId])).rows;
      const uniqueRecipients = [...new Set(recipients.map(r => r.id))];

      const notifStmt = client_TEMP(`
        INSERT INTO notifications (id, userId, type, title, message, relatedId, relatedType)
        VALUES ($26, $27, $28, $29, $30, $31, $32)
      `);
      for (const userId of uniqueRecipients) {
        await db.query(notifStmt_sql, [uuidv4(]), userId, 'schedule_cascade',
          `⚠ Schedule cascade on ${context.jobName}`,
          `"${task.name}" slip cascaded to ${shifted.length} tasks. ${shifted.length} schedule changes need approval.`,
          eventId, 'job_event'
        );
      }
    }
  
      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }
  return { shifted, totalShifted: shifted.length };
}

// ════════════════════════════════════════════════════════════════
// 2. EVENT-DRIVEN NOTIFICATIONS
// ════════════════════════════════════════════════════════════════

/**
 * Emit a job event and send notifications to relevant users.
 *
 * Event types:
 * - task_completed: A task reached 100%
 * - task_overdue: A task passed its scheduled finish date without completion
 * - scope_completed: All activities in a scope reached 100%
 * - milestone_missed: A milestone date passed without task completion
 * - schedule_slipped: A task's date was manually or auto-changed
 * - schedule_cascade: Multiple tasks shifted (generated by cascadeSchedule)
 * - budget_threshold: A budget alert rule was triggered
 * - change_order_submitted: New CO created
 * - change_order_approved: CO approved
 * - change_order_rejected: CO rejected
 * - approval_needed: Daily update or timesheet submitted
 *
 * @param {string} jobId - Job UUID
 * @param {string} eventType - One of the event types above
 * @param {Object} data - Event-specific data
 * @param {string} data.title - Notification title
 * @param {string} data.message - Notification message
 * @param {string} [data.severity] - 'low' | 'medium' | 'high' | 'critical' (default: 'medium')
 * @param {Object} [data.metadata] - Additional JSON data to store with the event
 * @param {string[]} [data.notifyUserIds] - Specific user IDs to notify (if empty, auto-determines)
 * @param {string} [data.relatedId] - ID of related entity (task, CO, etc.)
 * @param {string} [data.relatedType] - Type of related entity
 */
function emitJobEvent(jobId, eventType, data) {
  try {
    const eventId = uuidv4();
    const severity = data.severity || 'medium';

    // Insert job event
    (await db.query(`
      INSERT INTO job_events (id, jobId, eventType, severity, title, message, metadata, createdAt)
      VALUES ($33, $34, $35, $36, $37, $38, $39, NOW())
    `, [eventId, jobId, eventType, severity,
      data.title, data.message,
      data.metadata $40 JSON.stringify(data.metadata]) : null
    );

    // Determine notification recipients
    let recipientIds = data.notifyUserIds || [];

    if (recipientIds.length === 0) {
      // Auto-determine based on event type
      const job = (await db.query('SELECT foremanId FROM jobs WHERE id = $41', [jobId])).rows[0];

      if (['budget_threshold', 'change_order_submitted', 'change_order_approved', 'change_order_rejected'].includes(eventType)) {
        // Budget events → admins + PMs + foreman
        const users = (await db.query("SELECT id FROM users WHERE role IN ('admin', 'project_manager')")).rows;
        recipientIds = users.map(u => u.id);
        if (job$42.foremanId) recipientIds.push(job.foremanId);
      } else if (['task_completed', 'scope_completed', 'task_overdue', 'milestone_missed'].includes(eventType)) {
        // Progress events → foreman + PMs + admins
        const users = (await db.query("SELECT id FROM users WHERE role IN ('admin', 'project_manager')")).rows;
        recipientIds = users.map(u => u.id);
        if (job$43.foremanId) recipientIds.push(job.foremanId);
      } else if (eventType === 'approval_needed') {
        // Approval events → foreman + admins
        const users = (await db.query("SELECT id FROM users WHERE role IN ('admin', 'foreman')")).rows;
        recipientIds = users.map(u => u.id);
      } else {
        // Default: admins + PMs
        const users = (await db.query("SELECT id FROM users WHERE role IN ('admin', 'project_manager')")).rows;
        recipientIds = users.map(u => u.id);
      }
    }

    // Deduplicate
    recipientIds = [...new Set(recipientIds)];

    // Create notifications
    // Prepared statement converted to inline query
    const notifStmt_sql = `
      INSERT INTO notifications (id, userId, type, title, message, relatedId, relatedType)
      VALUES ($44, $45, $46, $47, $48, $49, $50)
    `;

    for (const userId of recipientIds) {
      await db.query(notifStmt_sql, [uuidv4(]), userId, eventType,
        data.title, data.message,
        data.relatedId || eventId,
        data.relatedType || 'job_event'
      );
    }

    return eventId;
  } catch (err) {
    console.error('[AutomationEngine] emitJobEvent error:', err.message);
    return null;
  }
}

/**
 * Check if a task is now complete (100%) and emit completion events.
 * Also checks if the parent scope is now fully complete.
 *
 * Called after daily update approval.
 *
 * @param {string} taskId - Task UUID
 * @param {string} jobId - Job UUID
 */
function checkTaskCompletion(taskId, jobId) {
  const task = (await db.query(`
    SELECT t.*, a.name as activityName, s.name as scopeName, s.id as scopeId
    FROM tasks t
    JOIN activities a ON t.activityId = a.id
    JOIN scopes s ON a.scopeId = s.id
    WHERE t.id = $51
  `, [taskId])).rows[0];

  if (!task || task.currentPercentComplete < 100) return;

  // Task completed event
  emitJobEvent(jobId, 'task_completed', {
    title: `✅ Task completed: ${task.name}`,
    message: `"${task.name}" (${task.scopeName} → ${task.activityName}) is now 100% complete.`,
    severity: 'low',
    metadata: { taskId, taskName: task.name, scopeName: task.scopeName, activityName: task.activityName },
    relatedId: taskId,
    relatedType: 'task',
  });

  // Check if all tasks in this scope are now complete
  const incompleteTasks = (await db.query(`
    SELECT COUNT(*) as cnt FROM tasks t
    JOIN activities a ON t.activityId = a.id
    WHERE a.scopeId = $1 AND t.currentPercentComplete < 100
  `, [task.scopeId])).rows[0];

  if (incompleteTasks.cnt === 0) {
    emitJobEvent(jobId, 'scope_completed', {
      title: `🎉 Scope completed: ${task.scopeName}`,
      message: `All tasks in "${task.scopeName}" are now 100% complete.`,
      severity: 'medium',
      metadata: { scopeId: task.scopeId, scopeName: task.scopeName },
      relatedId: task.scopeId,
      relatedType: 'scope',
    });
  }
}

/**
 * Check for overdue tasks on a job and generate events for any newly overdue.
 * "Overdue" = scheduledFinishDate < today AND currentPercentComplete < 100.
 *
 * Called periodically or on dashboard/overview load.
 *
 * @param {string} jobId - Job UUID
 * @returns {number} Number of newly detected overdue tasks
 */
function checkOverdueTasks(jobId) {
  const today = new Date().toISOString().split('T')[0];

  const overdueTasks = (await db.query(`
    SELECT t.id, t.name, t.scheduledFinishDate, t.currentPercentComplete,
           a.name as activityName, s.name as scopeName
    FROM tasks t
    JOIN activities a ON t.activityId = a.id
    JOIN scopes s ON a.scopeId = s.id
    WHERE s.jobId = $1
      AND t.scheduledFinishDate < $2
      AND t.currentPercentComplete < 100
      AND t.scheduledFinishDate IS NOT NULL
  `, [jobId, today])).rows;

  // Check which ones we've already flagged (avoid duplicate events)
  let newlyOverdue = 0;
  for (const task of overdueTasks) {
    const existing = (await db.query(`
      SELECT id FROM job_events
      WHERE jobId = $3 AND eventType = 'task_overdue' AND metadata LIKE $4
      AND createdAt > NOW() + INTERVAL '7 days'
    `, [jobId, `%"taskId":"${task.id}"%`])).rows[0];

    if (!existing) {
      const daysLate = daysBetween(task.scheduledFinishDate, today);
      emitJobEvent(jobId, 'task_overdue', {
        title: `⏰ Task overdue: ${task.name}`,
        message: `"${task.name}" was due ${task.scheduledFinishDate} (${daysLate} days ago) and is only ${task.currentPercentComplete}% complete.`,
        severity: daysLate > 14 $1 'high' : 'medium',
        metadata: { taskId: task.id, taskName: task.name, daysLate, percentComplete: task.currentPercentComplete },
        relatedId: task.id,
        relatedType: 'task',
      });
      newlyOverdue++;
    }
  }

  return newlyOverdue;
}

// ════════════════════════════════════════════════════════════════
// 3. BUDGET ALERT RULES
// ════════════════════════════════════════════════════════════════

/**
 * Default global alert rule thresholds.
 * These are created on first run and can be overridden per-job.
 */
const DEFAULT_ALERT_RULES = [
  { ruleType: 'scope_budget_pct', threshold: 80, label: 'Scope spend exceeds % of estimate', enabled: true },
  { ruleType: 'job_cpi_below', threshold: 0.85, label: 'Job CPI drops below threshold', enabled: true },
  { ruleType: 'labor_hours_over_pct', threshold: 120, label: 'Activity labor hours exceed % of estimate', enabled: true },
  { ruleType: 'change_order_total_pct', threshold: 10, label: 'Total change orders exceed % of original budget', enabled: true },
  { ruleType: 'variance_pct', threshold: 15, label: 'Scope actual vs estimate variance exceeds %', enabled: true },
  { ruleType: 'job_budget_pct', threshold: 80, label: 'Overall job spend exceeds % of adjusted budget', enabled: true },
];

/**
 * Seed default global alert rules if they don't exist yet.
 * Called from db initialization.
 */
function seedDefaultAlertRules() {
  const existing = (await db.query(`SELECT COUNT(*) as cnt FROM alert_rules WHERE jobId IS NULL`)).rows[0];
  if (existing.cnt > 0) return;

  const stmt = (await db.query(`
    INSERT INTO alert_rules (id, jobId, ruleType, threshold, label, enabled, createdAt)
    VALUES ($1, NULL, $2, $3, $4, $5, NOW())
  `);

  for (const rule of DEFAULT_ALERT_RULES) {
    stmt.run(uuidv4(), rule.ruleType, rule.threshold, rule.label, rule.enabled $6 1 : 0);
  }
}

/**
 * Get the effective alert rules for a job.
 * Per-job overrides take precedence over global defaults.
 *
 * @param {string} jobId - Job UUID
 * @returns {Array<{ruleType: string, threshold: number, enabled: boolean, isOverride: boolean}>}
 */
function getEffectiveRules(jobId) {
  const globalRules = (await db.query('SELECT * FROM alert_rules WHERE jobId IS NULL AND enabled = 1`)).rows;
  const jobRules = (await db.query(`SELECT * FROM alert_rules WHERE jobId = $7`, [jobId])).rows;

  const jobRuleMap = {};
  jobRules.forEach(r => { jobRuleMap[r.ruleType] = r; });

  return globalRules.map(gr => {
    const override = jobRuleMap[gr.ruleType];
    if (override) {
      return { ...override, isOverride: true };
    }
    return { ...gr, isOverride: false };
  }).filter(r => r.enabled);
}

/**
 * Run all budget alert checks for a job against its effective rules.
 * Generates job_events and notifications for any threshold breaches.
 *
 * Called after:
 * - Timesheet approval (labor hours/cost change)
 * - Budget item create/update (actual amount change)
 * - Change order approval (adjusted budget change)
 *
 * @param {string} jobId - Job UUID
 * @returns {{ triggered: Array<{ruleType: string, message: string}>, count: number }}
 */
function checkBudgetAlerts(jobId) {
  const rules = getEffectiveRules(jobId);
  if (rules.length === 0) return { triggered: [], count: 0 };

  const job = (await db.query('SELECT * FROM jobs WHERE id = $8', [jobId])).rows[0];
  if (!job || !job.budget) return { triggered: [], count: 0 };

  // Compute current financials
  const changeOrders = (await db.query(`
    SELECT COALESCE(SUM(amount), 0) as approved FROM change_orders WHERE jobId = $9 AND status = 'approved'
  `, [jobId])).rows[0];
  const pendingCOs = (await db.query(`
    SELECT COALESCE(SUM(amount), 0) as pending FROM change_orders WHERE jobId = $1 AND status = 'pending'
  `, [jobId])).rows[0];

  const adjustedBudget = job.budget + (changeOrders$1.approved || 0);

  const budgetItems = (await db.query(`
    SELECT bi.*, s.name as scopeName, a.name as activityName
    FROM budget_items bi
    LEFT JOIN scopes s ON bi.scopeId = s.id
    LEFT JOIN activities a ON bi.activityId = a.id
    WHERE bi.jobId = $1
  `, [jobId])).rows;

  const totalActual = budgetItems.reduce((s, bi) => s + (bi.actualAmount || 0), 0);
  const totalEstimated = budgetItems.reduce((s, bi) => s + (bi.estimatedAmount || 0), 0);

  // Scope-level aggregation
  const scopeData = {};
  budgetItems.forEach(bi => {
    if (!bi.scopeId) return;
    if (!scopeData[bi.scopeId]) scopeData[bi.scopeId] = { name: bi.scopeName, estimated: 0, actual: 0 };
    scopeData[bi.scopeId].estimated += bi.estimatedAmount || 0;
    scopeData[bi.scopeId].actual += bi.actualAmount || 0;
  });

  // Labor hours per activity
  const laborByActivity = (await db.query(`
    SELECT a.id, a.name, a.estimatedHours,
           COALESCE(SUM(te.hours), 0) as actualHours
    FROM activities a
    JOIN scopes s ON a.scopeId = s.id
    LEFT JOIN timesheet_entries te ON te.activityId = a.id AND te.status = 'approved'
    WHERE s.jobId = $2
    GROUP BY a.id
  `, [jobId])).rows;

  // CPI calculation
  const evData = computeSimpleEV(jobId, adjustedBudget, totalActual, totalEstimated);

  const triggered = [];

  // Deduplicate: don't fire the same rule type for the same job within 24 hours
  function alreadyFired(ruleType) {
    const recent = (await db.query(`
      SELECT id FROM job_events
      WHERE jobId = $3 AND eventType = 'budget_threshold'
      AND metadata LIKE $4
      AND createdAt > NOW() + INTERVAL '1 day'
    `, [jobId, `%"ruleType":"${ruleType}"%`])).rows[0];
    return !!recent;
  }

  for (const rule of rules) {
    if (alreadyFired(rule.ruleType)) continue;

    switch (rule.ruleType) {
      case 'scope_budget_pct': {
        for (const [scopeId, data] of Object.entries(scopeData)) {
          if (data.estimated <= 0) continue;
          const pct = (data.actual / data.estimated) * 100;
          if (pct >= rule.threshold) {
            const msg = `Scope "${data.name}" is at ${Math.round(pct)}% of budget (${fmt$(data.actual)} / ${fmt$(data.estimated)})`;
            triggered.push({ ruleType: rule.ruleType, message: msg });
            emitJobEvent(jobId, 'budget_threshold', {
              title: `💰 Budget alert: ${data.name}`,
              message: msg,
              severity: pct > 100 ? 'high' : 'medium',
              metadata: { ruleType: rule.ruleType, scopeId, scopeName: data.name, pct: Math.round(pct), threshold: rule.threshold },
            });
          }
        }
        break;
      }

      case 'job_cpi_below': {
        if (evData.CPI !== null && evData.CPI < rule.threshold) {
          const msg = `Job CPI is ${evData.CPI.toFixed(2)} (threshold: ${rule.threshold}). Spending $${(1 / evData.CPI).toFixed(2)} for every $1 of earned value.`;
          triggered.push({ ruleType: rule.ruleType, message: msg });
          emitJobEvent(jobId, 'budget_threshold', {
            title: `📊 CPI alert: ${job.name}`,
            message: msg,
            severity: evData.CPI < 0.7 ? 'critical' : 'high',
            metadata: { ruleType: rule.ruleType, CPI: evData.CPI, threshold: rule.threshold },
          });
        }
        break;
      }

      case 'labor_hours_over_pct': {
        for (const act of laborByActivity) {
          if (!act.estimatedHours || act.estimatedHours <= 0) continue;
          const pct = (act.actualHours / act.estimatedHours) * 100;
          if (pct >= rule.threshold) {
            const msg = `Activity "${act.name}" labor at ${Math.round(pct)}% of estimate (${act.actualHours}h / ${act.estimatedHours}h)`;
            triggered.push({ ruleType: rule.ruleType, message: msg });
            emitJobEvent(jobId, 'budget_threshold', {
              title: `⏱ Labor alert: ${act.name}`,
              message: msg,
              severity: pct > 150 ? 'high' : 'medium',
              metadata: { ruleType: rule.ruleType, activityId: act.id, activityName: act.name, pct: Math.round(pct), threshold: rule.threshold },
            });
          }
        }
        break;
      }

      case 'change_order_total_pct': {
        if (job.budget <= 0) break;
        const totalCOs = (changeOrders?.approved || 0) + (pendingCOs?.pending || 0);
        const coPct = (totalCOs / job.budget) * 100;
        if (coPct >= rule.threshold) {
          const msg = `Total change orders (${fmt$(totalCOs)}) are ${Math.round(coPct)}% of original budget (${fmt$(job.budget)})`;
          triggered.push({ ruleType: rule.ruleType, message: msg });
          emitJobEvent(jobId, 'budget_threshold', {
            title: `📝 Change order alert: ${job.name}`,
            message: msg,
            severity: coPct > 20 ? 'high' : 'medium',
            metadata: { ruleType: rule.ruleType, totalCOs, pct: Math.round(coPct), threshold: rule.threshold },
          });
        }
        break;
      }

      case 'variance_pct': {
        for (const [scopeId, data] of Object.entries(scopeData)) {
          if (data.estimated <= 0) continue;
          const variancePct = Math.abs(((data.actual - data.estimated) / data.estimated) * 100);
          if (data.actual > data.estimated && variancePct >= rule.threshold) {
            const msg = `Scope "${data.name}" variance is ${Math.round(variancePct)}% over estimate (${fmt$(data.actual)} vs ${fmt$(data.estimated)})`;
            triggered.push({ ruleType: rule.ruleType, message: msg });
            emitJobEvent(jobId, 'budget_threshold', {
              title: `⚠ Variance alert: ${data.name}`,
              message: msg,
              severity: variancePct > 30 ? 'high' : 'medium',
              metadata: { ruleType: rule.ruleType, scopeId, scopeName: data.name, variancePct: Math.round(variancePct), threshold: rule.threshold },
            });
          }
        }
        break;
      }

      case 'job_budget_pct': {
        if (adjustedBudget <= 0) break;
        const jobPct = (totalActual / adjustedBudget) * 100;
        if (jobPct >= rule.threshold) {
          const msg = `Job spend at ${Math.round(jobPct)}% of adjusted budget (${fmt$(totalActual)} / ${fmt$(adjustedBudget)})`;
          triggered.push({ ruleType: rule.ruleType, message: msg });
          emitJobEvent(jobId, 'budget_threshold', {
            title: `💰 Budget alert: ${job.name}`,
            message: msg,
            severity: jobPct > 95 ? 'critical' : 'high',
            metadata: { ruleType: rule.ruleType, pct: Math.round(jobPct), threshold: rule.threshold },
          });
        }
        break;
      }
    }
  }

  return { triggered, count: triggered.length };
}

/**
 * Simplified earned value computation for alert checking.
 */
function computeSimpleEV(jobId, adjustedBudget, totalActual, totalEstimated) {
  if (!adjustedBudget || adjustedBudget <= 0) return { CPI: null, SPI: null };

  // Get overall percent complete
  const progress = (await db.query(`
    SELECT AVG(sub.scopePct) as overallPct FROM (
      SELECT s.id, AVG(CASE WHEN t.id IS NOT NULL THEN t.currentPercentComplete ELSE a.percentComplete END) as scopePct
      FROM scopes s
      JOIN activities a ON a.scopeId = s.id
      LEFT JOIN tasks t ON t.activityId = a.id
      WHERE s.jobId = $1
      GROUP BY s.id
    ) sub
  `, [jobId])).rows[0];

  const pctComplete = (progress?.overallPct || 0) / 100;
  const EV = totalEstimated * pctComplete;
  const AC = totalActual;
  const CPI = AC > 0 ? EV / AC : null;

  return { CPI, EV, AC };
}

/**
 * Helper: format dollar amounts
 */
function fmt$(n) {
  return '$' + Math.round(n).toLocaleString();
}

// ════════════════════════════════════════════════════════════════
// EXPORTS
// ════════════════════════════════════════════════════════════════

module.exports = {
  // Scheduling cascade
  cascadeSchedule,
  addDays,
  daysBetween,

  // Event-driven notifications
  emitJobEvent,
  checkTaskCompletion,
  checkOverdueTasks,

  // Budget alerts
  seedDefaultAlertRules,
  getEffectiveRules,
  checkBudgetAlerts,
  DEFAULT_ALERT_RULES,
};
