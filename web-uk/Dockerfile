# =============================================================================
# NEXUS UK Frontend - Multi-stage Dockerfile
# Supports both development (hot reload) and production builds
# =============================================================================

# Supply an operator-approved digest for release builds, for example
# node:20-alpine@sha256:<digest>. The tag default is for local development only.
ARG NODE_IMAGE=node:20-alpine

# -----------------------------------------------------------------------------
# Base stage - shared between dev and prod
# -----------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS base
WORKDIR /app

# Install dependencies
COPY package*.json ./

# -----------------------------------------------------------------------------
# Development stage - hot reload with nodemon
# -----------------------------------------------------------------------------
FROM base AS development

# Install all dependencies (including devDependencies)
RUN npm ci --no-audit --no-fund

# Copy source files
COPY . .

# Build CSS initially
RUN npm run build:css

# Environment
ENV NODE_ENV=development
ENV PORT=3001

EXPOSE 3001

# Run dev server with hot reload (nodemon + sass watch)
CMD ["npm", "run", "dev"]

# -----------------------------------------------------------------------------
# Builder stage - build assets for production
# -----------------------------------------------------------------------------
FROM base AS builder

# Install all dependencies for building
RUN npm ci --no-audit --no-fund

# Copy source files
COPY . .

# Build CSS
RUN npm run build:css

# -----------------------------------------------------------------------------
# Production stage - minimal image
# -----------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS production

WORKDIR /app

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S appuser -u 1001

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

# Copy built assets and source from builder
COPY --from=builder /app/public ./public
COPY --from=builder /app/src ./src
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/contributors.json ./contributors.json

# Set ownership
RUN chown -R appuser:nodejs /app

# Switch to non-root user
USER appuser

# Environment
ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3001/health || exit 1

# Start application
CMD ["node", "src/server.js"]
