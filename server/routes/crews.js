/**
 * @file Crew management routes.
 * CRUD for named crews and crew member management.
 * @module server/routes/crews
 */

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { auth, requireSchedulePermission } = require('../middleware/auth');

router.use(auth);

/**
 * GET /api/crews — List all crews with member count.
 */
router.get('/', async (req, res) => {
  try {
    const crews = (await db.query(`
      SELECT c.*, COUNT(cm.id) as memberCount
      FROM crews c
      LEFT JOIN crew_members cm ON cm.crewId = c.id
      GROUP BY c.id
      ORDER BY c.name
    `)).rows;
    res.json(crews);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/crews/:id — Get crew with members array.
 */
router.get('/:id', async (req, res) => {
  try {
    const crew = (await db.query(`SELECT * FROM crews WHERE id = $1`, [req.params.id])).rows[0];
    if (!crew) return res.status(404).json({ error: 'Crew not found' });

    crew.members = (await db.query(`
      SELECT u.id, u.name, u.email, u.role, u.phone, cm.addedAt
      FROM crew_members cm
      JOIN users u ON cm.workerId = u.id
      WHERE cm.crewId = $1
      ORDER BY u.name
    `, [req.params.id])).rows;

    res.json(crew);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/crews — Create a new crew with optional members.
 */
router.post('/', requireSchedulePermission, async (req, res) => {
  try {
    const { name, description, memberIds } = req.body;
    if (!name) return res.status(400).json({ error: 'Crew name is required' });

    const id = uuidv4();
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      client_TEMP(
        "INSERT INTO crews (id, name, description, createdById, createdAt, updatedAt) VALUES (?, ?, ?, ?, NOW(), NOW())"
      , [id, name, description || null, req.user.id]);

      if (Array.isArray(memberIds)) {
        const insertMember = client_TEMP(
          "INSERT INTO crew_members (id, crewId, workerId, addedAt) VALUES (?, ?, ?, NOW())"
        );
        for (const workerId of memberIds) {
          insertMember.run(uuidv4(), id, workerId);
        }
      }
    
      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }

    const crew = (await db.query(`SELECT * FROM crews WHERE id = $1`, [id])).rows[0];
    crew.members = (await db.query(`
      SELECT u.id, u.name, u.email, u.role, u.phone, cm.addedAt
      FROM crew_members cm JOIN users u ON cm.workerId = u.id
      WHERE cm.crewId = $1 ORDER BY u.name
    `, [id])).rows;

    res.status(201).json(crew);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/crews/:id — Update crew name/description. Replace members if memberIds provided.
 */
router.put('/:id', requireSchedulePermission, async (req, res) => {
  try {
    const crew = (await db.query(`SELECT * FROM crews WHERE id = $1`, [req.params.id])).rows[0];
    if (!crew) return res.status(404).json({ error: 'Crew not found' });

    const { name, description, memberIds } = req.body;

    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      client_TEMP(
        "UPDATE crews SET name = ?, description = ?, updatedAt = NOW() WHERE id = ?"
      , [name || crew.name, description !== undefined ? description : crew.description, req.params.id]);

      if (Array.isArray(memberIds)) {
        (await db.query(`DELETE FROM crew_members WHERE crewId = $1', [req.params.id]);
        const insertMember = client_TEMP(
          "INSERT INTO crew_members (id, crewId, workerId, addedAt) VALUES ($2, $3, $4, NOW())"
        );
        for (const workerId of memberIds) {
          insertMember.run(uuidv4(), req.params.id, workerId);
        }
      }
    
      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }

    const updated = await db.query(`SELECT * FROM crews WHERE id = $5`, [req.params.id])).rows[0];
    updated.members = (await db.query(`
      SELECT u.id, u.name, u.email, u.role, u.phone, cm.addedAt
      FROM crew_members cm JOIN users u ON cm.workerId = u.id
      WHERE cm.crewId = $1 ORDER BY u.name
    `, [req.params.id])).rows;

    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/crews/:id — Delete crew, members, and nullify schedule references.
 */
router.delete('/:id', requireSchedulePermission, async (req, res) => {
  try {
    const crew = (await db.query(`SELECT * FROM crews WHERE id = $1`, [req.params.id])).rows[0];
    if (!crew) return res.status(404).json({ error: 'Crew not found' });

    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      (await db.query(`DELETE FROM schedule_assignments WHERE crewId = $1`, [req.params.id]);
      await db.query(`DELETE FROM crew_members WHERE crewId = $2`, [req.params.id]);
      await db.query(`DELETE FROM crews WHERE id = $3`, [req.params.id]);
    
      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }

    res.json({ message: 'Crew deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/crews/:id/members — Add a member to a crew.
 */
router.post('/:id/members', requireSchedulePermission, async (req, res) => {
  try {
    const { workerId } = req.body;
    if (!workerId) return res.status(400).json({ error: 'workerId is required' });

    const crew = await db.query(`SELECT * FROM crews WHERE id = $4`, [req.params.id])).rows[0];
    if (!crew) return res.status(404).json({ error: 'Crew not found' });

    const existing = (await db.query(`SELECT id FROM crew_members WHERE crewId = $1 AND workerId = $2`, [req.params.id, workerId])).rows[0];
    if (existing) return res.status(409).json({ error: 'Worker is already a member of this crew' });

    (await db.query(
      "INSERT INTO crew_members (id, crewId, workerId, addedAt) VALUES ($1, $2, $3, NOW())"
    , [uuidv4(]), req.params.id, workerId);

    res.status(201).json({ message: 'Member added' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/crews/:id/members/:workerId — Remove a member from a crew.
 */
router.delete('/:id/members/:workerId', requireSchedulePermission, async (req, res) => {
  try {
    const result = await db.query('DELETE FROM crew_members WHERE crewId = $4 AND workerId = $5', [req.params.id, req.params.workerId]);
    if (result.changes === 0) return res.status(404).json({ error: 'Member not found' });
    res.json({ message: 'Member removed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
