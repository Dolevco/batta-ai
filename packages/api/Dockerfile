FROM node:24-alpine AS builder

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy workspace files
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/core/package.json ./packages/core/
COPY packages/data-indexer/package.json ./packages/data-indexer/
COPY packages/api/package.json ./packages/api/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY packages/shared ./packages/shared
COPY packages/data-indexer ./packages/data-indexer
COPY packages/core ./packages/core
COPY packages/api ./packages/api
COPY tsconfig.json ./

# Build in dependency order: core → shared → api
RUN pnpm --filter @ai-agent/core build
RUN pnpm --filter @ai-agent/shared build
RUN pnpm --filter @ai-agent/data-indexer build
RUN pnpm --filter @ai-agent/api build

# Production stage
FROM node:24-alpine

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Install common coding tools in production image as requested
RUN apk add --no-cache git openssh build-base python3 make g++ curl bash nodejs npm

# Copy workspace files
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/core/package.json ./packages/core/
COPY packages/data-indexer/package.json ./packages/data-indexer/
COPY packages/api/package.json ./packages/api/

# Install production dependencies only
RUN pnpm install --frozen-lockfile --prod

# Copy built files from builder
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/core/dist ./packages/core/dist
COPY --from=builder /app/packages/data-indexer/dist ./packages/data-indexer/dist
COPY --from=builder /app/packages/api/dist ./packages/api/dist

# Expose port
EXPOSE 3001

# Start the API server
CMD ["node", "packages/api/dist/index.js"]
