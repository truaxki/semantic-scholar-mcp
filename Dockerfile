FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci

# Copy source and build
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# Production image
FROM node:20-alpine AS production

WORKDIR /app

# Install build tools needed for native modules (better-sqlite3)
RUN apk add --no-cache python3 make g++

# Install production dependencies
COPY package*.json ./
RUN npm ci --only=production && apk del python3 make g++

# Copy built files
COPY --from=builder /app/dist ./dist

# Create cache directory
RUN mkdir -p /app/cache

# Environment variables
ENV NODE_ENV=production
ENV PORT=3100
ENV HOST=0.0.0.0

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:${PORT}/health || exit 1

# Run as non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 -G nodejs && \
    chown -R nodejs:nodejs /app

USER nodejs

EXPOSE ${PORT}

CMD ["node", "dist/server.js"]
