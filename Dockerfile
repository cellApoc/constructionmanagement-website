# ============================================================
# Construction Management App — Docker Build
# Target: AWS Elastic Beanstalk (Docker platform)
# Database: Aurora PostgreSQL (IAM Authentication)
# ============================================================

# Stage 1: Build React frontend
FROM node:20-alpine AS frontend-build
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# Stage 2: Production server
FROM node:20-alpine AS production
WORKDIR /app

# Install server dependencies
# pg + @aws-sdk/rds-signer (no native modules — fast clean install)
COPY server/package*.json ./
RUN npm ci --omit=dev

# Copy server source
COPY server/ ./

# Copy built frontend
COPY --from=frontend-build /app/client/dist ./public

# Create uploads directory (fallback for local dev)
RUN mkdir -p uploads

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=3s --start-period=15s \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3001/api/auth/me || exit 1

CMD ["node", "index.js"]
