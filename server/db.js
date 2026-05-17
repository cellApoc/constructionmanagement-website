/**
 * db.js — PostgreSQL connection pool for Aurora PostgreSQL with IAM Authentication
 *
 * Uses AWS SDK to generate short-lived auth tokens (15-minute TTL) instead of
 * static passwords. Tokens are refreshed automatically before expiry.
 *
 * Install:  npm install pg @aws-sdk/rds-signer
 * Remove:   npm uninstall better-sqlite3
 *
 * Environment variables:
 *   DB_HOST     — Aurora cluster endpoint
 *   DB_PORT     — 5432
 *   DB_NAME     — Database name (default: postgres)
 *   DB_USER     — PostgreSQL username (default: postgres)
 *   AWS_REGION  — AWS region (default: us-east-2)
 *   DB_PASSWORD — Optional static password (for local dev; skips IAM auth if set)
 */

const { Pool } = require('pg');
const { Signer } = require('@aws-sdk/rds-signer');

const DB_HOST = process.env.DB_HOST || 'database-1.cluster-cvwu4y0ukbql.us-east-2.rds.amazonaws.com';
const DB_PORT = parseInt(process.env.DB_PORT || '5432', 10);
const DB_NAME = process.env.DB_NAME || 'postgres';
const DB_USER = process.env.DB_USER || 'postgres';
const AWS_REGION = process.env.AWS_REGION || 'us-east-2';
const DB_PASSWORD = process.env.DB_PASSWORD || null;
const USE_IAM_AUTH = !DB_PASSWORD;

async function generateAuthToken() {
  const signer = new Signer({ hostname: DB_HOST, port: DB_PORT, username: DB_USER, region: AWS_REGION });
  return signer.getAuthToken();
}

let pool = null;
let tokenExpiry = 0;

async function getPool() {
  const now = Date.now();
  if (!pool || (USE_IAM_AUTH && now > tokenExpiry - 120000)) {
    if (pool) await pool.end().catch(() => {});
    let password = DB_PASSWORD;
    if (USE_IAM_AUTH) {
      password = await generateAuthToken();
      tokenExpiry = now + 15 * 60 * 1000;
      console.log('[DB] IAM auth token generated');
    }
    pool = new Pool({
      host: DB_HOST, port: DB_PORT, database: DB_NAME, user: DB_USER, password,
      ssl: { rejectUnauthorized: false },
      max: 20, idleTimeoutMillis: 30000, connectionTimeoutMillis: 10000,
    });
    pool.on('error', (err) => { console.error('[DB] Pool error:', err.message); if (USE_IAM_AUTH) tokenExpiry = 0; });
    const client = await pool.connect();
    const { rows } = await client.query('SELECT NOW() as now, current_database() as db');
    console.log('[DB] Connected to', rows[0].db, 'at', DB_HOST);
    client.release();
  }
  return pool;
}

async function query(text, params) { const p = await getPool(); return p.query(text, params); }
async function getClient() { const p = await getPool(); return p.connect(); }

module.exports = { getPool, query, getClient };
