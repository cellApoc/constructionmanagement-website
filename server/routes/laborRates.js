const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { auth, requireRole } = require('../middleware/auth');

router.use(auth);

// GET /api/labor-rates — all labor rates (PM/Admin)
router.get('/', requireRole('project_manager', 'admin'), async (req, res) => {
  try {
    const rates = (await db.query(`
      SELECT lr.*, u.name as workerName, u.role as workerRole
      FROM labor_rates lr
      JOIN users u ON lr.workerId = u.id
      ORDER BY u.name, lr.trade, lr.effectiveDate DESC
    `)).rows;
    res.json(rates);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/labor-rates/trades — distinct trade names for autocomplete
router.get('/trades', requireRole('project_manager', 'admin'), async (req, res) => {
  try {
    const trades = (await db.query(`SELECT DISTINCT trade FROM labor_rates ORDER BY trade`)).rows;
    res.json(trades.map(t => t.trade));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/labor-rates/worker/:workerId — rates for a specific worker
router.get('/worker/:workerId', requireRole('project_manager', 'admin'), async (req, res) => {
  try {
    const rates = (await db.query(`
      SELECT * FROM labor_rates WHERE workerId = $1 ORDER BY trade, effectiveDate DESC
    `, [req.params.workerId])).rows;
    res.json(rates);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/labor-rates — create a labor rate
router.post('/', requireRole('project_manager', 'admin'), async (req, res) => {
  try {
    const { workerId, trade, hourlyRate, effectiveDate } = req.body;
    if (!workerId || !trade || hourlyRate == null) {
      return res.status(400).json({ error: 'workerId, trade, and hourlyRate are required' });
    }
    const worker = await db.query(`SELECT id FROM users WHERE id = $2`, [workerId])).rows[0];
    if (!worker) return res.status(404).json({ error: 'Worker not found' });

    const id = uuidv4();
    (await db.query(`
      INSERT INTO labor_rates (id, workerId, trade, hourlyRate, effectiveDate)
      VALUES ($1, $2, $3, $4, $5)
    `, [id, workerId, trade.trim(]), parseFloat(hourlyRate), effectiveDate || new Date().toISOString().split('T')[0]);

    const rate = (await db.query(`SELECT * FROM labor_rates WHERE id = $1`, [id])).rows[0];
    res.status(201).json(rate);
  } catch (err) {
    if (err.message.includes('UNIQUE constraint')) {
      return res.status(409).json({ error: 'A rate for this worker/trade/date already exists' });
    }
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/labor-rates/:id — update a labor rate
router.put('/:id', requireRole('project_manager', 'admin'), async (req, res) => {
  try {
    const existing = (await db.query(`SELECT * FROM labor_rates WHERE id = $1`, [req.params.id])).rows[0];
    if (!existing) return res.status(404).json({ error: 'Labor rate not found' });

    const { trade, hourlyRate, effectiveDate } = req.body;
    (await db.query(`
      UPDATE labor_rates SET trade=$6, hourlyRate=$7, effectiveDate=$8, updatedAt=NOW()
      WHERE id=$9
    `, [
      trade $10$11 existing.trade,
      hourlyRate != null $12 parseFloat(hourlyRate]) : existing.hourlyRate,
      effectiveDate $13$14 existing.effectiveDate,
      req.params.id
    );

    const rate = (await db.query(`SELECT * FROM labor_rates WHERE id = $1`, [req.params.id])).rows[0];
    res.json(rate);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/labor-rates/:id
router.delete('/:id', requireRole('project_manager', 'admin'), async (req, res) => {
  try {
    const existing = (await db.query(`SELECT * FROM labor_rates WHERE id = $1`, [req.params.id])).rows[0];
    if (!existing) return res.status(404).json({ error: 'Labor rate not found' });

    await db.query('DELETE FROM labor_rates WHERE id = $15', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
