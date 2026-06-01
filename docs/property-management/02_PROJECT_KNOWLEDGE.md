# Project Knowledge Base
## Construction Management & Property Management Apps

---

## 1. Construction Management App
**GitHub**: cellApoc/constructionmanagement-website
- Frontend: React 18 + Vite, Backend: Express + PostgreSQL
- Auth: JWT + bcrypt, Database: 28 tables, 19 route files
- Demo: admin@demo.com / password123 (admin, pm, foreman, worker roles)

## 2. AWS Infrastructure
- Account: Apoc (515206814213), Region: us-east-2
- Aurora PostgreSQL: cluster database-1, host database-1.cluster-cvwu4y0ukbql.us-east-2.rds.amazonaws.com
- Port 5432, DB postgres, User postgres
- Engine: aurora-postgresql 17.7 Serverless v2
- VPCNetworkingEnabled=false, InternetAccessGatewayEnabled=true
- IAM Auth MANDATORY. Static password does NOT work.
- MinCapacity=0.5 (auto-pause disabled), MaxCapacity=4

### EB Backend (cm-prod)
- App: construction-mgmt, Env: cm-prod, Node.js 20
- CNAME: cm-prod.eba-umb5mfpi.us-east-2.elasticbeanstalk.com
- HTTP only (no HTTPS). Version: v10
- Env vars: DB_HOST, DB_PORT=5432, DB_NAME=postgres, DB_USER=postgres, AWS_REGION=us-east-2, JWT_SECRET, FRONTEND_URL, NODE_ENV=production, PORT=8080. NO DB_PASSWORD.

## 3. Cloudflare
- Email: Mike@apocalypsehow.com, Account ID: 52c1aa7b616d424a52cb621d3557213c
- Workers subdomain: mike-52c.workers.dev
- Pages: construction-mgmt at construction-mgmt-djy.pages.dev (direct upload)
- Worker proxy: cm-api-proxy at cm-api-proxy.mike-52c.workers.dev

## 4. Architecture
Browser(HTTPS) > CF Pages > CF Worker(HTTPS proxy) > EB(HTTP) > Aurora(IAM auth)
CRITICAL: VITE_API_URL must be in BOTH AuthContext.jsx AND ApiContext.jsx

## 5. DB Schema Rules
- Most tables: unquoted camelCase = stored LOWERCASE
- Exceptions (quoted camelCase): alert_rules, job_events
- ALWAYS verify column names against schema before writing queries

## 6. Key Lessons
- Aurora+InternetAccessGateway = IAM auth mandatory
- Password changes need instance REBOOT
- EB single instance has NO HTTPS - use Worker proxy
- CF Pages _redirects 200 does NOT proxy POST
- CF Pages direct upload has NO Functions
- dotenv must be optional (try/catch) in production
- db.js uses @aws-sdk/rds-signer for IAM tokens (15-min TTL)
- Set MinCapacity=0.5 to prevent auto-pause
- CF Worker deployed via JS injection on dashboard

## 7. Status
- Backend v10: 41/41 endpoints pass
- Frontend: needs ApiContext fix reupload

## 8. NEW: Property Management App
- Convert static Meridian Properties site to full React+Express+PostgreSQL
- Source: github.com/dsansom-cell/propertymanagement-website
- Brand: Meridian Properties (Cormorant Garamond + Inter)
- Properties: The Ashford, Meridian Tower, The Linden
- Features: rentals, condos/HOA, resident portal, owner portal, applications
- Same AWS account + same Aurora cluster + same database
- New tables with pm_ prefix alongside construction mgmt tables
- New EB env, new CF Pages, new CF Worker proxy
