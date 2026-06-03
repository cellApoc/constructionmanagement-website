/**
 * db.js — PostgreSQL connection for Aurora, standardized on @apoc/aws-pg-connect.
 *
 * This replaces the previous bespoke rds-signer pool. It now connects the SAME
 * way as every other Apoc app (the shared package), which fixes two flaws in the
 * old implementation:
 *   - TLS was `rejectUnauthorized: false` (encrypted but UNVERIFIED) → the package
 *     defaults to verify-full when a CA is supplied (set DB_CA_CERT to the RDS
 *     global bundle), and warns otherwise.
 *   - IAM token refresh tore down and rebuilt the whole pool every ~13 min,
 *     dropping in-flight connections → the package re-signs the token PER new
 *     connection (pg async password), so the pool is never torn down.
 *
 * Public API is unchanged: getPool() / query() / getClient().
 *
 * Environment (read by the package):
 *   DB_HOST, DB_PORT, DB_NAME, DB_USER, AWS_REGION  — connection parts
 *   DB_AUTH=iam (default here when no static creds) | secrets
 *   DB_SECRET_ID (secrets mode), DB_CA_CERT (verify-full)
 *   DB_PASSWORD or DATABASE_URL — local/static dev (skips IAM)
 *
 * Note: @apoc/aws-pg-connect is an ESM package; this CommonJS module loads it via
 * dynamic import().
 */

let poolPromise = null;

function buildOpts() {
  // Local/static dev: a static password or a full URL skips IAM.
  const hasStatic = !!(process.env.DATABASE_URL || process.env.DB_PASSWORD);
  if (process.env.DB_PASSWORD && !process.env.DATABASE_URL) {
    const u = encodeURIComponent(process.env.DB_USER || 'postgres');
    const p = encodeURIComponent(process.env.DB_PASSWORD);
    const host = process.env.DB_HOST || 'localhost';
    const port = process.env.DB_PORT || '5432';
    const name = process.env.DB_NAME || 'postgres';
    process.env.DATABASE_URL = `postgresql://${u}:${p}@${host}:${port}/${name}?sslmode=require`;
  }
  return {
    mode: hasStatic ? 'static' : (process.env.DB_AUTH || 'iam'),
    pool: { max: 20, idleTimeoutMillis: 30000, connectionTimeoutMillis: 10000 },
  };
}

async function getPool() {
  if (!poolPromise) {
    const { createPgPool } = await import('@cellapoc/aws-pg-connect/pg');
    poolPromise = createPgPool(buildOpts()).then(async (pool) => {
      pool.on('error', (err) => console.error('[DB] Pool error:', err.message));
      const client = await pool.connect();
      try {
        const { rows } = await client.query('SELECT current_database() AS db');
        console.log('[DB] Connected to', rows[0].db, 'via @apoc/aws-pg-connect');
      } finally {
        client.release();
      }
      return pool;
    });
  }
  return poolPromise;
}

async function query(text, params) { const p = await getPool(); return p.query(text, params); }
async function getClient() { const p = await getPool(); return p.connect(); }

module.exports = { getPool, query, getClient };
