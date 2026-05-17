/**
 * @file Authentication and authorization middleware.
 * Provides JWT token verification and role-based access control for Express routes.
 * @module server/middleware/auth
 */

const jwt = require('jsonwebtoken');
const db = require('../db');

/** @type {string} JWT signing secret, sourced from environment or a default fallback */
const JWT_SECRET = process.env.JWT_SECRET || 'construction-mgmt-secret-key';

/**
 * Express middleware that verifies a JWT Bearer token from the Authorization header.
 * On success, attaches the authenticated user object (without password) to `req.user`.
 * On failure, responds with 401 Unauthorized.
 * @param {import('express').Request} req - Express request object
 * @param {import('express').Response} res - Express response object
 * @param {import('express').NextFunction} next - Express next middleware function
 * @returns {void}
 */
function auth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);

    const user = (await db.query(`SELECT id, email, name, role, phone, createdAt FROM users WHERE id = $1`, [decoded.userId])).rows[0];
    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

/**
 * Express middleware factory that restricts access to users with specific roles.
 * Must be used after the `auth` middleware so that `req.user` is populated.
 * Responds with 401 if not authenticated or 403 if the user's role is not in the allowed list.
 * @param {...string} roles - Allowed role names (e.g. 'admin', 'project_manager', 'foreman', 'worker')
 * @returns {import('express').RequestHandler} Express middleware function
 */
function requireRole(...roles) {
  return async (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

/**
 * Express middleware that restricts schedule write operations based on configurable
 * app_settings and optional per-job overrides. Workers are always read-only.
 * Reads 'schedule_manage_roles' from app_settings and optionally checks job_settings.
 * @param {import('express').Request} req - Express request object
 * @param {import('express').Response} res - Express response object
 * @param {import('express').NextFunction} next - Express next middleware function
 * @returns {void}
 */
function requireSchedulePermission(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  if (req.user.role === 'worker') {
    return res.status(403).json({ error: 'Workers cannot modify schedules' });
  }
  const setting = (await db.query(`SELECT value FROM app_settings WHERE key = 'schedule_manage_roles'`)).rows[0];
  const allowedRoles = setting ? JSON.parse(setting.value) : ['admin', 'project_manager', 'foreman'];
  if (!allowedRoles.includes(req.user.role)) {
    return res.status(403).json({ error: 'Insufficient scheduling permissions' });
  }
  const jobId = req.body?.jobId || req.params?.jobId;
  if (jobId) {
    const jobSetting = (await db.query(`SELECT value FROM job_settings WHERE jobId = $1 AND key = 'schedule_manage_roles'`, [jobId])).rows[0];
    if (jobSetting) {
      const jobRoles = JSON.parse(jobSetting.value);
      if (!jobRoles.includes(req.user.role)) {
        return res.status(403).json({ error: 'Insufficient scheduling permissions for this job' });
      }
    }
  }
  next();
}

module.exports = { auth, requireRole, requireSchedulePermission, JWT_SECRET };
