/**
 * @file Authentication routes for user registration, login, and current user retrieval.
 * @module server/routes/auth
 */

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { auth, JWT_SECRET } = require('../middleware/auth');

const router = express.Router();

/**
 * POST /api/auth/register
 * Register a new user account. Hashes the password with bcrypt and returns a JWT token.
 * @param {string} req.body.email - User email address (must be unique)
 * @param {string} req.body.password - Plain-text password (will be hashed)
 * @param {string} req.body.name - User display name
 * @param {string} req.body.role - User role ('worker', 'foreman', 'project_manager', 'admin')
 * @param {string} [req.body.phone] - Optional phone number
 * @returns {Object} 201 - { token: string, user: { id, email, name, role, phone } }
 * @returns {Object} 400 - { error: string } if required fields are missing
 * @returns {Object} 409 - { error: string } if email is already registered
 */
router.post('/register', async (req, res) => {
  try {
    const { email, password, name, role, phone } = req.body;

    if (!email || !password || !name || !role) {
      return res.status(400).json({ error: 'email, password, name, and role are required' });
    }

    const existing = (await db.query(`SELECT id FROM users WHERE email = $1`, [email])).rows[0];
    if (existing) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const hashedPassword = bcrypt.hashSync(password, 10);
    const id = uuidv4();

    await db.query('INSERT INTO users (id, email, password, name, role, phone) VALUES ($1, $2, $3, $4, $5, $6)', [id, email, hashedPassword, name, role, phone || null]);

    const token = jwt.sign({ userId: id }, JWT_SECRET, { expiresIn: '7d' });
    const user = { id, email, name, role, phone: phone || null };

    res.status(201).json({ token, user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/auth/login
 * Authenticate a user with email and password. Returns a JWT token valid for 7 days.
 * @param {string} req.body.email - User email address
 * @param {string} req.body.password - Plain-text password to verify
 * @returns {Object} 200 - { token: string, user: { id, email, name, role, phone, createdAt } }
 * @returns {Object} 400 - { error: string } if email or password is missing
 * @returns {Object} 401 - { error: string } if credentials are invalid
 */
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'email and password are required' });
    }

    const user = (await db.query(`SELECT * FROM users WHERE email = $1`, [email])).rows[0];
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const valid = bcrypt.compareSync(password, user.password);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });
    const { password: _, ...userData } = user;

    res.json({ token, user: userData });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/auth/me
 * Retrieve the currently authenticated user's profile. Requires a valid JWT token.
 * @returns {Object} 200 - { user: { id, email, name, role, phone, createdAt } }
 * @returns {Object} 401 - { error: string } if not authenticated
 */
router.get('/me', auth, async (req, res) => {
  try {
    res.json({ user: req.user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
