# ===================================
# STAGE 1: Dependencies
# ===================================
FROM node:20-alpine AS dependencies
WORKDIR /app

# Install dependencies needed for native modules and git for yarn
RUN apk add --no-cache python3 make g++ openssl git

# Copy package files
COPY package.json yarn.lock ./

# Install all dependencies using yarn
RUN yarn install --frozen-lockfile

# ===================================
# STAGE 2: Builder
# ===================================
FROM node:20-alpine AS builder
WORKDIR /app

# Copy dependencies from previous stage
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .

# Generate Prisma Client
RUN npx prisma generate

# Build the application
RUN yarn build

# ===================================
# STAGE 3: Production
# ===================================
FROM node:20-alpine AS production
WORKDIR /app

# Install runtime dependencies
RUN apk add --no-cache openssl tini

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nestjs -u 1001

# Copy necessary files
COPY --from=builder --chown=nestjs:nodejs /app/package.json ./
COPY --from=builder --chown=nestjs:nodejs /app/yarn.lock ./
COPY --from=builder --chown=nestjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nestjs:nodejs /app/dist ./dist
COPY --from=builder --chown=nestjs:nodejs /app/src/prisma ./src/prisma

# Set environment
ENV NODE_ENV=production \
    PORT=3000

# Switch to non-root user
USER nestjs

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Use tini as init system
ENTRYPOINT ["/sbin/tini", "--"]

# Start application (migrations run before start)
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]