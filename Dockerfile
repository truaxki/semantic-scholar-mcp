FROM node:20-alpine AS builder

WORKDIR /app

# Install all dependencies (including native modules like better-sqlite3)
COPY package*.json ./
RUN npm ci

# Copy source and build TypeScript
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# Prune dev dependencies
RUN npm prune --production

# Production image
FROM node:20-alpine AS production

WORKDIR /app

# Copy production node_modules (with pre-built native modules) from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package.json ./

# Create cache directory
RUN mkdir -p /app/cache

ENV NODE_ENV=production

# Run as non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 -G nodejs && \
    chown -R nodejs:nodejs /app

USER nodejs

CMD ["node", "dist/server.js"]
