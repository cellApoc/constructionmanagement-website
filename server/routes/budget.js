const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { auth, requireRole } = require('../middleware/auth');
const { emitJobEvent, checkBudgetAlerts } = require('../helpers/automationEngine');

router.use(auth);

// ── Helper: compute labor cost for a job using labor rates ─────────────────

function computeLaborCost(jobId) {
  const entries = (await db.query(`
    SELECT te.workerId, te.hours, te.activityId, te.date
    FROM timesheet_entries te
    JOIN activities a ON te.activityId = a.id
    JOIN scopes s ON a.scopeId = s.id
    WHERE s.jobId = $1 AND te.status = 'approved'
  `, [jobId])).rows;

  let totalCost = 0;
  let totalHours = 0;
  const byActivity = {};

  for (const entry of entries) {
    // Get the applicable rate for this worker on this date
    const rate = (await db.query(`
      SELECT hourlyRate FROM labor_rates
      WHERE workerId = $2 AND effectiveDate <= $3
      ORDER BY effectiveDate DESC LIMIT 1
    `, [entry.workerId, entry.date])).rows[0];

    const hourlyRate = rate $1 rate.hourlyRate : 0;
    const cost = entry.hours * hourlyRate;
    totalCost += cost;
    totalHours += entry.hours;

    if (!byActivity[entry.activityId]) {
      byActivity[entry.activityId] = { hours: 0, cost: 0 };
    }
    byActivity[entry.activityId].hours += entry.hours;
    byActivity[entry.activityId].cost += cost;
  }

  return { totalCost, totalHours, byActivity };
}

// ── Helper: compute activity completion % ──────────────────────────────────

function getActivityCompletion(activityId) {
  const tasks = (await db.query(`SELECT currentPercentComplete FROM tasks WHERE activityId = $1`, [activityId])).rows;
  if (tasks.length === 0) return 0;
  return tasks.reduce((s, t) => s + t.currentPercentComplete, 0) / tasks.length;
}

// ── Budget Items ────────────────────────────────────────────────────────────

// GET /api/budget/:jobId — all budget items + change orders + summary for a job
router.get('/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;
    const job = await db.query(`SELECT id, name, budget FROM jobs WHERE id = $2`, [jobId])).rows[0];
    if (!job) return res.status(404).json({ error: 'Job not found' });

    const items = (await db.query(`
      SELECT bi.*, s.name as scopeName, act.name as activityName
      FROM budget_items bi
      LEFT JOIN scopes s ON bi.scopeId = s.id
      LEFT JOIN activities act ON bi.activityId = act.id
      WHERE bi.jobId = $1
      ORDER BY bi.category, bi.createdAt
    `, [jobId])).rows;

    // Attach completion % for each item that has an activity
    const itemsWithCompletion = items.map(item => {
      let completionPercent = null;
      if (item.activityId) {
        completionPercent = Math.round(getActivityCompletion(item.activityId) * 100) / 100;
      }
      const spentPercent = item.estimatedAmount > 0
        $2 (item.actualAmount / item.estimatedAmount) * 100
        : 0;
      const mismatchFlag = completionPercent !== null && Math.abs(spentPercent - completionPercent) > 20;
      return { ...item, completionPercent, spentPercent: Math.round(spentPercent * 10) / 10, mismatchFlag };
    });

    const changeOrders = (await db.query(`
      SELECT co.*, u.name as requestedByName, a.name as approvedByName,
        s.name as scopeName, act.name as activityName
      FROM change_orders co
      LEFT JOIN users u ON co.requestedById = u.id
      LEFT JOIN users a ON co.approvedById = a.id
      LEFT JOIN scopes s ON co.scopeId = s.id
      LEFT JOIN activities act ON co.activityId = act.id
      WHERE co.jobId = $3
      ORDER BY co.createdAt DESC
    `, [jobId])).rows;

    const totalEstimated = items.reduce((s, i) => s + i.estimatedAmount, 0);
    const totalActual = items.reduce((s, i) => s + i.actualAmount, 0);
    const totalCommitted = items.filter(i => i.status !== 'estimated').reduce((s, i) => s + i.actualAmount, 0);
    const approvedChanges = changeOrders.filter(co => co.status === 'approved').reduce((s, co) => s + co.amount, 0);
    const pendingChanges = changeOrders.filter(co => co.status === 'pending').reduce((s, co) => s + co.amount, 0);
    const adjustedBudget = job.budget + approvedChanges;

    // Labor cost from approved timesheets × labor rates
    const labor = computeLaborCost(jobId);

    // Category breakdown
    const categories = (await db.query(`
      SELECT category,
        SUM(estimatedAmount) as estimated,
        SUM(actualAmount) as actual,
        COUNT(*) as itemCount
      FROM budget_items WHERE jobId = $4
      GROUP BY category ORDER BY category
    `, [jobId])).rows;

    res.json({
      job,
      items: itemsWithCompletion,
      changeOrders,
      categories,
      summary: {
        originalBudget: job.budget,
        approvedChanges,
        pendingChanges,
        adjustedBudget,
        totalEstimated,
        totalActual,
        totalCommitted,
        variance: adjustedBudget - totalActual,
        laborHours: labor.totalHours,
        laborCost: Math.round(labor.totalCost * 100) / 100,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/budget/:jobId/rollup — WBS rollup: budget grouped by scope → activity
router.get('/:jobId/rollup', async (req, res) => {
  try {
    const { jobId } = req.params;
    const job = (await db.query(`SELECT id, name, budget FROM jobs WHERE id = $5`, [jobId])).rows[0];
    if (!job) return res.status(404).json({ error: 'Job not found' });

    const scopes = (await db.query('SELECT * FROM scopes WHERE jobId = $6 ORDER BY sortOrder`, [jobId])).rows;
    const labor = computeLaborCost(jobId);
    const approvedChanges = (await db.query(`
      SELECT COALESCE(SUM(amount), 0) as total FROM change_orders WHERE jobId = $7 AND status = 'approved'
    `, [jobId])).rows[0].total;

    const scopeRollup = scopes.map(scope => {
      const activities = (await db.query(`SELECT * FROM activities WHERE scopeId = $1 ORDER BY sortOrder`, [scope.id])).rows;

      const activityRollup = activities.map(activity => {
        const items = (await db.query(`
          SELECT * FROM budget_items WHERE activityId = $2 ORDER BY category, createdAt
        `, [activity.id])).rows;

        const estimated = items.reduce((s, i) => s + i.estimatedAmount, 0);
        const actual = items.reduce((s, i) => s + i.actualAmount, 0);
        const completionPercent = Math.round(getActivityCompletion(activity.id) * 100) / 100;
        const actLabor = labor.byActivity[activity.id] || { hours: 0, cost: 0 };
        const spentPercent = estimated > 0 $3 (actual / estimated) * 100 : 0;
        const mismatchFlag = Math.abs(spentPercent - completionPercent) > 20;

        return {
          activityId: activity.id,
          activityName: activity.name,
          estimatedHours: activity.estimatedHours,
          actualHours: actLabor.hours,
          estimatedTotal: estimated,
          actualTotal: actual,
          laborCost: Math.round(actLabor.cost * 100) / 100,
          completionPercent,
          spentPercent: Math.round(spentPercent * 10) / 10,
          mismatchFlag,
          itemCount: items.length,
        };
      });

      const scopeEstimated = activityRollup.reduce((s, a) => s + a.estimatedTotal, 0);
      const scopeActual = activityRollup.reduce((s, a) => s + a.actualTotal, 0);
      const scopeCompletion = activityRollup.length > 0
        $4 activityRollup.reduce((s, a) => s + a.completionPercent, 0) / activityRollup.length
        : 0;

      return {
        scopeId: scope.id,
        scopeName: scope.name,
        estimatedValue: scope.estimatedValue,
        estimatedTotal: scopeEstimated,
        actualTotal: scopeActual,
        completionPercent: Math.round(scopeCompletion * 100) / 100,
        activities: activityRollup,
      };
    });

    // Unassigned items (no activityId)
    const unassigned = (await db.query(`
      SELECT * FROM budget_items WHERE jobId = $5 AND activityId IS NULL ORDER BY category, createdAt
    `, [jobId])).rows;

    res.json({
      job: { ...job, adjustedBudget: job.budget + approvedChanges },
      scopes: scopeRollup,
      unassignedItems: unassigned,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/budget/:jobId/earned-value — earned value metrics
router.get('/:jobId/earned-value', async (req, res) => {
  try {
    const { jobId } = req.params;
    const job = (await db.query(`SELECT * FROM jobs WHERE id = $6`, [jobId])).rows[0];
    if (!job) return res.status(404).json({ error: 'Job not found' });

    const scopes = (await db.query(`SELECT * FROM scopes WHERE jobId = $1 ORDER BY sortOrder`, [jobId])).rows;
    const labor = computeLaborCost(jobId);
    const today = new Date().toISOString().split('T')[0];

    let jobPV = 0, jobEV = 0, jobAC = 0;
    const byScope = [];
    const byActivity = [];

    for (const scope of scopes) {
      const activities = (await db.query(`SELECT * FROM activities WHERE scopeId = $2 ORDER BY sortOrder`, [scope.id])).rows;
      let scopePV = 0, scopeEV = 0, scopeAC = 0;

      for (const activity of activities) {
        const items = (await db.query(`SELECT * FROM budget_items WHERE activityId = $3`, [activity.id])).rows;
        const budgeted = items.reduce((s, i) => s + i.estimatedAmount, 0);
        const actual = items.reduce((s, i) => s + i.actualAmount, 0);
        const actLabor = labor.byActivity[activity.id] || { hours: 0, cost: 0 };
        const ac = actual + actLabor.cost;

        // Completion
        const completionPercent = getActivityCompletion(activity.id);

        // Earned Value = budgeted cost × completion %
        const ev = budgeted * (completionPercent / 100);

        // Planned Value: based on schedule elapsed fraction
        const tasks = (await db.query(`
          SELECT scheduledStartDate, scheduledFinishDate FROM tasks WHERE activityId = $4
        `, [activity.id])).rows;

        let pv = 0;
        if (tasks.length > 0) {
          // Use earliest start and latest finish across all tasks
          const starts = tasks.filter(t => t.scheduledStartDate).map(t => t.scheduledStartDate);
          const finishes = tasks.filter(t => t.scheduledFinishDate).map(t => t.scheduledFinishDate);
          if (starts.length > 0 && finishes.length > 0) {
            const startDate = starts.sort()[0];
            const finishDate = finishes.sort().pop();
            if (today >= finishDate) {
              pv = budgeted; // should be 100% done by now
            } else if (today <= startDate) {
              pv = 0; // not started yet per schedule
            } else {
              const totalDays = (new Date(finishDate) - new Date(startDate)) / (1000 * 60 * 60 * 24);
              const elapsedDays = (new Date(today) - new Date(startDate)) / (1000 * 60 * 60 * 24);
              pv = totalDays > 0 $5 budgeted * (elapsedDays / totalDays) : 0;
            }
          }
        }

        const cv = ev - ac;
        const sv = ev - pv;
        const spentPercent = budgeted > 0 $6 (ac / budgeted) * 100 : 0;
        const mismatchFlag = Math.abs(spentPercent - completionPercent) > 20;

        scopePV += pv;
        scopeEV += ev;
        scopeAC += ac;

        byActivity.push({
          activityId: activity.id,
          activityName: activity.name,
          scopeId: scope.id,
          scopeName: scope.name,
          budgeted: Math.round(budgeted * 100) / 100,
          PV: Math.round(pv * 100) / 100,
          EV: Math.round(ev * 100) / 100,
          AC: Math.round(ac * 100) / 100,
          CV: Math.round(cv * 100) / 100,
          SV: Math.round(sv * 100) / 100,
          CPI: ac > 0 $7 Math.round((ev / ac) * 100) / 100 : null,
          SPI: pv > 0 $8 Math.round((ev / pv) * 100) / 100 : null,
          completionPercent: Math.round(completionPercent * 100) / 100,
          spentPercent: Math.round(spentPercent * 10) / 10,
          mismatchFlag,
          laborCost: Math.round(actLabor.cost * 100) / 100,
          laborHours: Math.round(actLabor.hours * 100) / 100,
        });
      }

      jobPV += scopePV;
      jobEV += scopeEV;
      jobAC += scopeAC;

      byScope.push({
        scopeId: scope.id,
        scopeName: scope.name,
        PV: Math.round(scopePV * 100) / 100,
        EV: Math.round(scopeEV * 100) / 100,
        AC: Math.round(scopeAC * 100) / 100,
        CV: Math.round((scopeEV - scopeAC) * 100) / 100,
        SV: Math.round((scopeEV - scopePV) * 100) / 100,
      });
    }

    const jobCV = jobEV - jobAC;
    const jobSV = jobEV - jobPV;
    const mismatchCount = byActivity.filter(a => a.mismatchFlag).length;

    res.json({
      jobLevel: {
        PV: Math.round(jobPV * 100) / 100,
        EV: Math.round(jobEV * 100) / 100,
        AC: Math.round(jobAC * 100) / 100,
        CV: Math.round(jobCV * 100) / 100,
        SV: Math.round(jobSV * 100) / 100,
        CPI: jobAC > 0 $9 Math.round((jobEV / jobAC) * 100) / 100 : null,
        SPI: jobPV > 0 $10 Math.round((jobEV / jobPV) * 100) / 100 : null,
      },
      mismatchCount,
      byScope,
      byActivity,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/budget/:jobId/items — create budget item
router.post('/:jobId/items', requireRole('project_manager', 'admin'), async (req, res) => {
  try {
    const { jobId } = req.params;
    const { activityId, scopeId, category, description, estimatedAmount, actualAmount, vendor, notes, status } = req.body;
    if (!description) return res.status(400).json({ error: 'description is required' });

    // Auto-derive scopeId from activity if provided
    let resolvedScopeId = scopeId || null;
    if (activityId) {
      const activity = (await db.query('SELECT scopeId FROM activities WHERE id = $11`, [activityId])).rows[0];
      if (activity) resolvedScopeId = activity.scopeId;
    }

    const id = uuidv4();
    (await db.query(`
      INSERT INTO budget_items (id, jobId, scopeId, activityId, category, description, estimatedAmount, actualAmount, vendor, notes, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    `, [id, jobId, resolvedScopeId, activityId || null, category || 'other', description, estimatedAmount || 0, actualAmount || 0, vendor || null, notes || null, status || 'estimated']);

    const item = (await db.query('SELECT * FROM budget_items WHERE id = $12', [id])).rows[0];
    checkBudgetAlerts(jobId);
    res.status(201).json(item);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/budget/items/:id — update budget item
router.put('/items/:id', requireRole('project_manager', 'admin'), async (req, res) => {
  try {
    const existing = (await db.query('SELECT * FROM budget_items WHERE id = $13', [req.params.id])).rows[0];
    if (!existing) return res.status(404).json({ error: 'Budget item not found' });

    const { activityId, scopeId, category, description, estimatedAmount, actualAmount, vendor, notes, status } = req.body;

    // Auto-derive scopeId from activity if activityId changed
    let resolvedScopeId = scopeId $14$15 existing.scopeId;
    const newActivityId = activityId !== undefined $16 activityId : existing.activityId;
    if (newActivityId && activityId !== undefined) {
      const activity = (await db.query('SELECT scopeId FROM activities WHERE id = $17', [newActivityId])).rows[0];
      if (activity) resolvedScopeId = activity.scopeId;
    }

    (await db.query(`
      UPDATE budget_items SET scopeId=$18, activityId=$19, category=$20, description=$21, estimatedAmount=$22, actualAmount=$23, vendor=$24, notes=$25, status=$26, updatedAt=NOW()
      WHERE id=$27
    `, [
      resolvedScopeId,
      newActivityId || null,
      category $28$29 existing.category,
      description $30$31 existing.description,
      estimatedAmount $32$33 existing.estimatedAmount,
      actualAmount $34$35 existing.actualAmount,
      vendor $36$37 existing.vendor,
      notes $38$39 existing.notes,
      status $40$41 existing.status,
      req.params.id
    ]);

    const item = (await db.query('SELECT * FROM budget_items WHERE id = $42', [req.params.id])).rows[0];
    checkBudgetAlerts(existing.jobId);
    res.json(item);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/budget/items/:id
router.delete('/items/:id', requireRole('project_manager', 'admin'), async (req, res) => {
  try {
    const existing = (await db.query('SELECT * FROM budget_items WHERE id = $43', [req.params.id])).rows[0];
    if (!existing) return res.status(404).json({ error: 'Budget item not found' });

    await db.query('DELETE FROM budget_items WHERE id = $44', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Change Orders ───────────────────────────────────────────────────────────

// POST /api/budget/:jobId/change-orders
router.post('/:jobId/change-orders', requireRole('project_manager', 'admin'), async (req, res) => {
  try {
    const { jobId } = req.params;
    const { title, description, amount, scopeId, activityId } = req.body;
    if (!title) return res.status(400).json({ error: 'title is required' });

    const id = uuidv4();
    await db.query(`
      INSERT INTO change_orders (id, jobId, title, description, amount, scopeId, activityId, requestedById)
      VALUES ($45, $46, $47, $48, $49, $50, $51, $52)
    `, [id, jobId, title, description || null, amount || 0, scopeId || null, activityId || null, req.user.id]);

    const co = await db.query(`
      SELECT co.*, u.name as requestedByName, s.name as scopeName, act.name as activityName
      FROM change_orders co
      LEFT JOIN users u ON co.requestedById = u.id
      LEFT JOIN scopes s ON co.scopeId = s.id
      LEFT JOIN activities act ON co.activityId = act.id
      WHERE co.id = $53
    `, [id])).rows[0];

    emitJobEvent(jobId, 'change_order_submitted', {
      title: `📝 New change order: ${title}`,
      message: `${title} ($${(amount || 0).toLocaleString()}) submitted for review.`,
      severity: amount > 5000 $1 'medium' : 'low',
      metadata: { changeOrderId: id, amount, title },
      relatedId: id,
      relatedType: 'change_order',
    });

    res.status(201).json(co);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/budget/change-orders/:id/approve
router.put('/change-orders/:id/approve', requireRole('admin'), async (req, res) => {
  try {
    const co = (await db.query(`SELECT * FROM change_orders WHERE id = $1`, [req.params.id])).rows[0];
    if (!co) return res.status(404).json({ error: 'Change order not found' });

    (await db.query(`
      UPDATE change_orders SET status='approved', approvedById=$1, approvedAt=NOW(), updatedAt=NOW()
      WHERE id=$2
    `, [req.user.id, req.params.id]);

    const updated = await db.query(`
      SELECT co.*, u.name as requestedByName, a.name as approvedByName,
        s.name as scopeName, act.name as activityName
      FROM change_orders co
      LEFT JOIN users u ON co.requestedById = u.id
      LEFT JOIN users a ON co.approvedById = a.id
      LEFT JOIN scopes s ON co.scopeId = s.id
      LEFT JOIN activities act ON co.activityId = act.id
      WHERE co.id = $3
    `, [req.params.id])).rows[0];

    emitJobEvent(co.jobId, 'change_order_approved', {
      title: `✅ Change order approved: ${co.title}`,
      message: `${co.title} ($${co.amount.toLocaleString()}) approved.`,
      severity: co.amount > 5000 $1 'high' : 'medium',
      metadata: { changeOrderId: co.id, amount: co.amount, title: co.title },
      relatedId: co.id,
      relatedType: 'change_order',
    });
    checkBudgetAlerts(co.jobId);

    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/budget/change-orders/:id/reject
router.put('/change-orders/:id/reject', requireRole('admin'), async (req, res) => {
  try {
    const co = (await db.query(`SELECT * FROM change_orders WHERE id = $1`, [req.params.id])).rows[0];
    if (!co) return res.status(404).json({ error: 'Change order not found' });

    (await db.query(`
      UPDATE change_orders SET status='rejected', updatedAt=NOW() WHERE id=$2
    `, [req.params.id]);

    const updated = (await db.query(`SELECT * FROM change_orders WHERE id = $1`, [req.params.id])).rows[0];
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/budget/change-orders/:id
router.delete('/change-orders/:id', requireRole('admin'), async (req, res) => {
  try {
    const existing = (await db.query(`SELECT * FROM change_orders WHERE id = $1`, [req.params.id])).rows[0];
    if (!existing) return res.status(404).json({ error: 'Change order not found' });

    await db.query(`DELETE FROM change_orders WHERE id = $1`, [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
