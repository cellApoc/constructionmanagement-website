/**
 * @file User management routes for listing, retrieving, and updating users.
 * All routes require authentication. Listing requires project_manager or admin role.
 * Updating requires admin role.
 * @module server/routes/users
 */

const express = require('express');
const db = require('../db');
const { auth, requireRole } = require('../middleware/auth');

const router = express.Router();

router.use(auth);

/**
 * GET /api/users
 * List all users (excludes password field).
 * @requires role project_manager or admin
 * @returns {Object[]} Array of user objects sorted by name
 */
router.get('/', requireRole('admin', 'project_manager'), async (req, res) => {
  try {
    const users = (await db.query(`SELECT id, email, name, role, phone, createdAt FROM users ORDER BY name`)).rows;
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/users/:id
 * Retrieve a single user by ID (excludes password field).
 * @param {string} req.params.id - User UUID
 * @returns {Object} User object or 404 if not found
 */
router.get('/:id', async (req, res) => {
  try {
    const user = (await db.query('SELECT id, email, name, role, phone, createdAt FROM users WHERE id = $1`, [req.params.id])).rows[0];
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/users/:id
 * Update a user's name, role, phone, or email.
 * @requires role admin
 * @param {string} req.params.id - User UUID
 * @param {string} [req.body.name] - Updated display name
 * @param {string} [req.body.role] - Updated role (worker|foreman|project_manager|admin)
 * @param {string} [req.body.phone] - Updated phone number
 * @param {string} [req.body.email] - Updated email
 * @returns {Object} Updated user object
 */
router.put('/:id', requireRole('admin'), async (req, res) => {
  try {
    const existing = (await db.query(`SELECT * FROM users WHERE id = $1`, [req.params.id])).rows[0];
    if (!existing) return res.status(404).json({ error: 'User not found' });

    const { name, role, phone, email } = req.body;

    await db.query('UPDATE users SET name=$1, role=$2, phone=$3, email=$4 WHERE id=$5', [
      name ?? existing.name,
      role ?? existing.role,
      phone ?? existing.phone,
      email ?? existing.email,
      req.params.id
    ]);

    const user = (await db.query(`SELECT id, email, name, role, phone, createdAt FROM users WHERE id = $1`, [req.params.id])).rows[0];
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
