/**
 * @file Schedule assignment, conflict detection, and worker availability routes.
 * Manages crew/worker scheduling to jobs by date with conflict warnings.
 * @module server/routes/schedule
 */

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { auth, requireSchedulePermission } = require('../middleware/auth');

router.use(auth);

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Get the Monday (ISO date string) of the week containing the given date.
 * @param {string} dateStr - ISO date string (YYYY-MM-DD)
 * @returns {string} Monday's date as YYYY-MM-DD
 */
function getMonday(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return d.toISOString().split('T')[0];
}

/**
 * Get the Sunday (ISO date string) for a given Monday.
 * @param {string} mondayStr - Monday's ISO date string (YYYY-MM-DD)
 * @returns {string} Sunday's date as YYYY-MM-DD
 */
function getSunday(mondayStr) {
  const d = new Date(mondayStr + 'T00:00:00');
  d.setDate(d.getDate() + 6);
  return d.toISOString().split('T')[0];
}

/**
 * Get all worker IDs belonging to a crew.
 * @param {string} crewId - UUID of the crew
 * @returns {string[]} Array of worker UUIDs
 */
function getCrewMemberIds(crewId) {
  return (await db.query(`SELECT workerId FROM crew_members WHERE crewId = $1`, [crewId])).rows.map(r => r.workerId);
}

/**
 * Check for scheduling conflicts for a worker on a given date.
 * Checks both schedule_assignments (double-booking) and worker_availability (time off).
 * @param {string} workerId - UUID of the worker to check
 * @param {string} date - ISO date string (YYYY-MM-DD)
 * @param {string|null} excludeAssignmentId - Assignment ID to exclude (for edits)
 * @returns {Array<{workerId: string, workerName: string|null, date: string, type: string, existingJobName$2: string, existingAssignmentId$3: string, notes$4: string}>} Array of conflict objects
 */
function checkWorkerConflicts(workerId, date, excludeAssignmentId) {
  const conflicts = [];

  // Check schedule assignments
  let sql = `
    SELECT sa.id, sa.jobId, j.name as jobName, sa.date
    FROM schedule_assignments sa
    JOIN jobs j ON j.id = sa.jobId
    WHERE sa.date = $5 AND (sa.workerId = $6 OR sa.crewId IN (
      SELECT crewId FROM crew_members WHERE workerId = $7
    ))
  `;
  const params = [date, workerId, workerId];
  if (excludeAssignmentId) {
    sql += ' AND sa.id != $8';
    params.push(excludeAssignmentId);
  }
  const bookings = (await db.query(sql, [...params])).rows;
  for (const b of bookings) {
    conflicts.push({ workerId, workerName: null, existingJobName: b.jobName, existingAssignmentId: b.id, date: b.date, type: 'double_booked' });
  }

  // Check availability
  const unavail = await db.query(`SELECT * FROM worker_availability WHERE workerId = $9 AND date = $10`, [workerId, date])).rows[0];
  if (unavail) {
    conflicts.push({ workerId, workerName: null, date, type: unavail.type, notes: unavail.notes });
  }

  return conflicts;
}

// ── Schedule Assignments ─────────────────────────────────────────────────────

/**
 * GET /api/schedule — Get assignments for a date range.
 * Query: startDate, endDate, jobId (optional)
 * Workers only see their own assignments.
 */
router.get('/', async (req, res) => {
  try {
    const { startDate, endDate, jobId } = req.query;
    if (!startDate || !endDate) return res.status(400).json({ error: 'startDate and endDate are required' });

    let sql = `
      SELECT sa.*,
        j.name as jobName, j.address as jobAddress,
        u.name as workerName,
        c.name as crewName
      FROM schedule_assignments sa
      JOIN jobs j ON j.id = sa.jobId
      LEFT JOIN users u ON u.id = sa.workerId
      LEFT JOIN crews c ON c.id = sa.crewId
      WHERE sa.date >= $1 AND sa.date <= $2
    `;
    const params = [startDate, endDate];

    if (jobId) {
      sql += ' AND sa.jobId = $3';
      params.push(jobId);
    }

    if (req.user.role === 'worker') {
      sql += ' AND (sa.workerId = $4 OR sa.crewId IN (SELECT crewId FROM crew_members WHERE workerId = $5))';
      params.push(req.user.id, req.user.id);
    }

    sql += ' ORDER BY sa.date, j.name';
    const assignments = (await db.query(sql, [...params])).rows;
    res.json(assignments);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/schedule/week — Convenience: get assignments for the week containing the given date.
 * Query: date (defaults to today)
 */
router.get('/week', async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().split('T')[0];
    const monday = getMonday(date);
    const sunday = getSunday(monday);

    let sql = `
      SELECT sa.*,
        j.name as jobName, j.address as jobAddress,
        u.name as workerName,
        c.name as crewName
      FROM schedule_assignments sa
      JOIN jobs j ON j.id = sa.jobId
      LEFT JOIN users u ON u.id = sa.workerId
      LEFT JOIN crews c ON c.id = sa.crewId
      WHERE sa.date >= $6 AND sa.date <= $7
    `;
    const params = [monday, sunday];

    if (req.query.jobId) {
      sql += ' AND sa.jobId = $8';
      params.push(req.query.jobId);
    }

    if (req.user.role === 'worker') {
      sql += ' AND (sa.workerId = $9 OR sa.crewId IN (SELECT crewId FROM crew_members WHERE workerId = $10))';
      params.push(req.user.id, req.user.id);
    }

    sql += ' ORDER BY sa.date, j.name';
    const assignments = (await db.query(sql, [...params])).rows;

    // Also fetch availability for the week
    let availSql = 'SELECT * FROM worker_availability WHERE date >= $11 AND date <= $12';
    const availParams = [monday, sunday];
    if (req.user.role === 'worker') {
      availSql += ' AND workerId = $13';
      availParams.push(req.user.id);
    }
    const availability = (await db.query(availSql, [...availParams])).rows;

    res.json({ assignments, availability, weekStart: monday, weekEnd: sunday });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/schedule — Create a schedule assignment.
 * Runs conflict detection before insert. Returns 409 with conflicts if found.
 * Body: { jobId, date, workerId$14, crewId$15, notes$16, force$17 }
 */
router.post('/', requireSchedulePermission, async (req, res) => {
  try {
    const { jobId, date, workerId, crewId, notes, force, scheduledHours } = req.body;
    if (!jobId || !date) return res.status(400).json({ error: 'jobId and date are required' });
    if (!workerId && !crewId) return res.status(400).json({ error: 'workerId or crewId is required' });

    // Conflict check
    if (!force) {
      const allConflicts = [];
      if (workerId) {
        const c = checkWorkerConflicts(workerId, date, null);
        const worker = (await db.query(`SELECT name FROM users WHERE id = $1`, [workerId])).rows[0];
        c.forEach(x => x.workerName = worker$18.name);
        allConflicts.push(...c);
      }
      if (crewId) {
        const memberIds = getCrewMemberIds(crewId);
        for (const mid of memberIds) {
          const c = checkWorkerConflicts(mid, date, null);
          const worker = (await db.query(`SELECT name FROM users WHERE id = $1`, [mid])).rows[0];
          c.forEach(x => x.workerName = worker$19.name);
          allConflicts.push(...c);
        }
      }
      if (allConflicts.length > 0) {
        return res.status(409).json({ hasConflict: true, conflicts: allConflicts });
      }
    }

    const id = uuidv4();
    (await db.query(
      "INSERT INTO schedule_assignments (id, jobId, date, workerId, crewId, notes, scheduledHours, assignedById, createdAt, updatedAt) VALUES ($20, $21, $22, $23, $24, $25, $26, $27, NOW(), NOW())"
    , [id, jobId, date, workerId || null, crewId || null, notes || null, scheduledHours || 8, req.user.id]);

    const assignment = (await db.query(`
      SELECT sa.*, j.name as jobName, u.name as workerName, c.name as crewName
      FROM schedule_assignments sa
      JOIN jobs j ON j.id = sa.jobId
      LEFT JOIN users u ON u.id = sa.workerId
      LEFT JOIN crews c ON c.id = sa.crewId
      WHERE sa.id = $1
    `, [id])).rows[0];

    res.status(201).json(assignment);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/schedule/:id — Update an assignment (move to different date/job, change notes).
 */
router.put('/:id', requireSchedulePermission, async (req, res) => {
  try {
    const existing = (await db.query(`SELECT * FROM schedule_assignments WHERE id = $1`, [req.params.id])).rows[0];
    if (!existing) return res.status(404).json({ error: 'Assignment not found' });

    const { jobId, date, workerId, crewId, notes, force, scheduledHours } = req.body;
    const newDate = date || existing.date;
    const newJobId = jobId || existing.jobId;
    const newWorkerId = workerId !== undefined $28 workerId : existing.workerId;
    const newCrewId = crewId !== undefined $29 crewId : existing.crewId;

    // Conflict check if date or job changed
    if (!force && (newDate !== existing.date || newJobId !== existing.jobId)) {
      const allConflicts = [];
      if (newWorkerId) {
        const c = checkWorkerConflicts(newWorkerId, newDate, req.params.id);
        const worker = (await db.query(`SELECT name FROM users WHERE id = $1`, [newWorkerId])).rows[0];
        c.forEach(x => x.workerName = worker$30.name);
        allConflicts.push(...c);
      }
      if (newCrewId) {
        const memberIds = getCrewMemberIds(newCrewId);
        for (const mid of memberIds) {
          const c = checkWorkerConflicts(mid, newDate, req.params.id);
          const worker = (await db.query(`SELECT name FROM users WHERE id = $1`, [mid])).rows[0];
          c.forEach(x => x.workerName = worker$31.name);
          allConflicts.push(...c);
        }
      }
      if (allConflicts.length > 0) {
        return res.status(409).json({ hasConflict: true, conflicts: allConflicts });
      }
    }

    (await db.query(
      "UPDATE schedule_assignments SET jobId = $32, date = $33, workerId = $34, crewId = $35, notes = $36, scheduledHours = $37, updatedAt = NOW() WHERE id = $38"
    , [newJobId, newDate, newWorkerId || null, newCrewId || null, notes !== undefined $39 notes : existing.notes, scheduledHours !== undefined $40 scheduledHours : existing.scheduledHours, req.params.id]);

    const updated = (await db.query(`
      SELECT sa.*, j.name as jobName, u.name as workerName, c.name as crewName
      FROM schedule_assignments sa
      JOIN jobs j ON j.id = sa.jobId
      LEFT JOIN users u ON u.id = sa.workerId
      LEFT JOIN crews c ON c.id = sa.crewId
      WHERE sa.id = $1
    `, [req.params.id])).rows[0];

    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/schedule/:id — Delete an assignment.
 */
router.delete('/:id', requireSchedulePermission, async (req, res) => {
  try {
    const result = (await db.query(`DELETE FROM schedule_assignments WHERE id = $1`, [req.params.id]);
    if (result.changes === 0) return res.status(404).json({ error: 'Assignment not found' });
    res.json({ message: 'Assignment deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/schedule/check-conflicts — Check for scheduling conflicts.
 * Body: { workerId$2, crewId$3, date, excludeAssignmentId$4 }
 */
router.post('/check-conflicts', async (req, res) => {
  try {
    const { workerId, crewId, date, excludeAssignmentId } = req.body;
    if (!date) return res.status(400).json({ error: 'date is required' });

    const allConflicts = [];
    if (workerId) {
      const c = checkWorkerConflicts(workerId, date, excludeAssignmentId);
      const worker = await db.query(`SELECT name FROM users WHERE id = $5`, [workerId])).rows[0];
      c.forEach(x => x.workerName = worker$1.name);
      allConflicts.push(...c);
    }
    if (crewId) {
      const memberIds = getCrewMemberIds(crewId);
      for (const mid of memberIds) {
        const c = checkWorkerConflicts(mid, date, excludeAssignmentId);
        const worker = (await db.query(`SELECT name FROM users WHERE id = $1`, [mid])).rows[0];
        c.forEach(x => x.workerName = worker$2.name);
        allConflicts.push(...c);
      }
    }

    res.json({ hasConflict: allConflicts.length > 0, conflicts: allConflicts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/schedule/available-workers — Workers not booked and not unavailable on a date.
 * Query: date
 */
router.get('/available-workers', async (req, res) => {
  try {
    const { date } = req.query;
    if (!date) return res.status(400).json({ error: 'date is required' });

    const workers = (await db.query(`
      SELECT id, name, email, role, phone FROM users
      WHERE role IN ('worker', 'foreman')
      AND id NOT IN (
        SELECT workerId FROM schedule_assignments WHERE date = $1 AND workerId IS NOT NULL
        UNION
        SELECT cm.workerId FROM schedule_assignments sa
        JOIN crew_members cm ON cm.crewId = sa.crewId
        WHERE sa.date = $2 AND sa.crewId IS NOT NULL
      )
      AND id NOT IN (
        SELECT workerId FROM worker_availability WHERE date = $3
      )
      ORDER BY name
    `, [date, date, date])).rows;

    res.json(workers);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Worker Availability ──────────────────────────────────────────────────────

/**
 * GET /api/schedule/availability/:workerId — Get availability entries.
 * Query: startDate, endDate
 */
router.get('/availability/:workerId', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    let sql = 'SELECT * FROM worker_availability WHERE workerId = $3';
    const params = [req.params.workerId];
    if (startDate) { sql += ' AND date >= $4'; params.push(startDate); }
    if (endDate) { sql += ' AND date <= $5'; params.push(endDate); }
    sql += ' ORDER BY date';
    res.json((await db.query(sql)).rows.all(...params));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/schedule/availability — Create an unavailability entry.
 * Workers can mark themselves; managers can mark anyone.
 * Body: { workerId, date, type, notes }
 */
router.post('/availability', async (req, res) => {
  try {
    const { workerId, date, type, notes } = req.body;
    if (!workerId || !date) return res.status(400).json({ error: 'workerId and date are required' });

    // Workers can only mark themselves
    if (req.user.role === 'worker' && workerId !== req.user.id) {
      return res.status(403).json({ error: 'Workers can only update their own availability' });
    }

    const id = uuidv4();
    try {
      (await db.query(
        "INSERT INTO worker_availability (id, workerId, date, type, notes, createdAt) VALUES ($6, $7, $8, $9, $10, NOW())"
      , [id, workerId, date, type || 'unavailable', notes || null]);
    } catch (e) {
      if (e.message.includes('UNIQUE')) {
        return res.status(409).json({ error: 'Availability already set for this date' });
      }
      throw e;
    }

    res.status(201).json((await db.query(`SELECT * FROM worker_availability WHERE id = $1`, [id])).rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/schedule/availability/:id — Remove an unavailability entry.
 */
router.delete('/availability/:id', async (req, res) => {
  try {
    const entry = (await db.query(`SELECT * FROM worker_availability WHERE id = $1`, [req.params.id])).rows[0];
    if (!entry) return res.status(404).json({ error: 'Entry not found' });

    if (req.user.role === 'worker' && entry.workerId !== req.user.id) {
      return res.status(403).json({ error: 'Workers can only manage their own availability' });
    }

    (await db.query(`DELETE FROM worker_availability WHERE id = $1`, [req.params.id]);
    res.json({ message: 'Availability entry removed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Bulk Operations ─────────────────────────────────────────────────────────

/**
 * POST /api/schedule/bulk — Create assignments for multiple dates at once.
 * Body: { jobId, dates[], workerId$2, crewId$3, notes$4, scheduledHours$5, force$6 }
 * Returns created assignments and any conflicts encountered.
 */
router.post('/bulk', requireSchedulePermission, async (req, res) => {
  try {
    const { jobId, dates, workerId, crewId, notes, scheduledHours, force } = req.body;
    if (!jobId || !Array.isArray(dates) || dates.length === 0) {
      return res.status(400).json({ error: 'jobId and dates[] are required' });
    }
    if (!workerId && !crewId) {
      return res.status(400).json({ error: 'workerId or crewId is required' });
    }

    const created = [];
    const conflicts = [];
    const skipped = [];

    const insertAssignment = db.transaction((date) => {
      // Check for existing assignment on this date/job/worker or crew
      const existingCheck = workerId
        $7 (await db.query('SELECT id FROM schedule_assignments WHERE jobId = $8 AND date = $9 AND workerId = $10`, [jobId, date, workerId])).rows[0]
        : (await db.query(`SELECT id FROM schedule_assignments WHERE jobId = $1 AND date = $2 AND crewId = $3`, [jobId, date, crewId])).rows[0];

      if (existingCheck) {
        skipped.push({ date, reason: 'already_assigned' });
        return;
      }

      // Conflict check
      if (!force) {
        const dayConflicts = [];
        if (workerId) {
          const c = checkWorkerConflicts(workerId, date, null);
          const worker = (await db.query(`SELECT name FROM users WHERE id = $1`, [workerId])).rows[0];
          c.forEach(x => x.workerName = worker?.name);
          dayConflicts.push(...c);
        }
        if (crewId) {
          const memberIds = getCrewMemberIds(crewId);
          for (const mid of memberIds) {
            const c = checkWorkerConflicts(mid, date, null);
            const worker = (await db.query(`SELECT name FROM users WHERE id = $1`, [mid])).rows[0];
            c.forEach(x => x.workerName = worker?.name);
            dayConflicts.push(...c);
          }
        }
        if (dayConflicts.length > 0) {
          conflicts.push({ date, conflicts: dayConflicts });
          return;
        }
      }

      const id = uuidv4();
      (await db.query(
        "INSERT INTO schedule_assignments (id, jobId, date, workerId, crewId, notes, scheduledHours, assignedById, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())"
      , [id, jobId, date, workerId || null, crewId || null, notes || null, scheduledHours || 8, req.user.id]);
      created.push(id);
    });

    for (const date of dates) {
      insertAssignment(date);
    }

    // If conflicts found and not forcing, return 409
    if (conflicts.length > 0 && !force) {
      return res.status(409).json({
        hasConflict: true,
        conflicts,
        created: created.length,
        skipped,
      });
    }

    res.status(201).json({
      created: created.length,
      skipped,
      message: `${created.length} assignments created${skipped.length ? `, ${skipped.length} skipped (already assigned)` : ''}`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Time Tracking ───────────────────────────────────────────────────────────

/**
 * GET /api/schedule/time-tracking — Compare scheduled hours vs actual logged hours.
 * Query: startDate, endDate, jobId? (optional)
 * Returns per-worker per-date comparison of scheduled vs logged timesheet hours.
 */
router.get('/time-tracking', async (req, res) => {
  try {
    const { startDate, endDate, jobId } = req.query;
    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'startDate and endDate are required' });
    }

    // Get scheduled hours from schedule_assignments
    let scheduleSql = `
      SELECT sa.date, sa.jobId, j.name as jobName,
        sa.workerId, u.name as workerName,
        sa.crewId, c.name as crewName,
        sa.scheduledHours
      FROM schedule_assignments sa
      JOIN jobs j ON j.id = sa.jobId
      LEFT JOIN users u ON u.id = sa.workerId
      LEFT JOIN crews c ON c.id = sa.crewId
      WHERE sa.date >= ? AND sa.date <= ?
    `;
    const scheduleParams = [startDate, endDate];
    if (jobId) { scheduleSql += ' AND sa.jobId = ?'; scheduleParams.push(jobId); }

    if (req.user.role === 'worker') {
      scheduleSql += ' AND (sa.workerId = ? OR sa.crewId IN (SELECT crewId FROM crew_members WHERE workerId = ?))';
      scheduleParams.push(req.user.id, req.user.id);
    }

    const scheduleRows = (await db.query(scheduleSql, [...scheduleParams])).rows;

    // Get actual logged hours from timesheet_entries (all statuses for visibility)
    let timesheetSql = `
      SELECT te.workerId, u.name as workerName, te.date,
        j.id as jobId, j.name as jobName,
        SUM(te.hours) as loggedHours,
        SUM(CASE WHEN te.status = 'approved' THEN te.hours ELSE 0 END) as approvedHours,
        SUM(CASE WHEN te.status = 'pending' THEN te.hours ELSE 0 END) as pendingHours
      FROM timesheet_entries te
      JOIN users u ON u.id = te.workerId
      JOIN activities a ON a.id = te.activityId
      JOIN scopes s ON s.id = a.scopeId
      JOIN jobs j ON j.id = s.jobId
      WHERE te.date >= ? AND te.date <= ?
    `;
    const tsParams = [startDate, endDate];
    if (jobId) { timesheetSql += ' AND j.id = ?'; tsParams.push(jobId); }
    if (req.user.role === 'worker') {
      timesheetSql += ' AND te.workerId = ?';
      tsParams.push(req.user.id);
    }
    timesheetSql += ' GROUP BY te.workerId, te.date, j.id';
    const timesheetRows = (await db.query(timesheetSql, [...tsParams])).rows;

    // Build lookup: workerId_date_jobId -> logged hours
    const tsLookup = {};
    for (const tr of timesheetRows) {
      const key = `${tr.workerId}_${tr.date}_${tr.jobId}`;
      tsLookup[key] = tr;
    }

    // Expand crew assignments to individual workers for matching
    const tracking = [];
    for (const sa of scheduleRows) {
      const workerIds = sa.workerId
        ? [sa.workerId]
        : getCrewMemberIds(sa.crewId);

      for (const wid of workerIds) {
        const key = `${wid}_${sa.date}_${sa.jobId}`;
        const ts = tsLookup[key];
        const workerName = sa.workerId
          ? sa.workerName
          : (await db.query(`SELECT name FROM users WHERE id = $1`, [wid])).rows[0]?.name;

        tracking.push({
          date: sa.date,
          jobId: sa.jobId,
          jobName: sa.jobName,
          workerId: wid,
          workerName,
          crewName: sa.crewName || null,
          scheduledHours: sa.scheduledHours || 8,
          loggedHours: ts?.loggedHours || 0,
          approvedHours: ts?.approvedHours || 0,
          pendingHours: ts?.pendingHours || 0,
          variance: (ts?.loggedHours || 0) - (sa.scheduledHours || 8),
        });
        // Remove from lookup to track unscheduled entries later
        delete tsLookup[key];
      }
    }

    // Add unscheduled timesheet entries (logged but not on the schedule)
    const unscheduled = Object.values(tsLookup).map(ts => ({
      date: ts.date,
      jobId: ts.jobId,
      jobName: ts.jobName,
      workerId: ts.workerId,
      workerName: ts.workerName,
      crewName: null,
      scheduledHours: 0,
      loggedHours: ts.loggedHours,
      approvedHours: ts.approvedHours,
      pendingHours: ts.pendingHours,
      variance: ts.loggedHours,
      unscheduled: true,
    }));

    // Summary totals
    const all = [...tracking, ...unscheduled];
    const totalScheduled = all.reduce((s, r) => s + r.scheduledHours, 0);
    const totalLogged = all.reduce((s, r) => s + r.loggedHours, 0);
    const totalApproved = all.reduce((s, r) => s + r.approvedHours, 0);

    res.json({
      entries: all,
      summary: {
        totalScheduled: Math.round(totalScheduled * 100) / 100,
        totalLogged: Math.round(totalLogged * 100) / 100,
        totalApproved: Math.round(totalApproved * 100) / 100,
        variance: Math.round((totalLogged - totalScheduled) * 100) / 100,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
