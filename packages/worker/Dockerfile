FROM node:24-alpine AS base

# Install pnpm
RUN npm install -g pnpm

# Set working directory
WORKDIR /app

# Copy workspace files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/worker/package.json ./packages/worker/
COPY packages/core/package.json ./packages/core/
COPY packages/shared/package.json ./packages/shared/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source files
COPY packages/worker ./packages/worker
COPY packages/core ./packages/core
COPY packages/shared ./packages/shared
COPY tsconfig.json ./

# Build packages
RUN pnpm --filter @ai-agent/core build
RUN pnpm --filter @ai-agent/shared build
RUN pnpm --filter @ai-agent/worker build

# Production stage
FROM node:24-alpine

# Install common coding tools in production image as requested
RUN apk add --no-cache git openssh build-base python3 make g++ curl bash nodejs npm

# Install pnpm
RUN npm install -g pnpm

WORKDIR /app

# Copy package files
COPY --from=base /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=base /app/packages/worker/package.json ./packages/worker/
COPY --from=base /app/packages/core/package.json ./packages/core/
COPY --from=base /app/packages/shared/package.json ./packages/shared/

# Install production dependencies only
RUN pnpm install --frozen-lockfile --prod

# Copy built files
COPY --from=base /app/packages/worker/dist ./packages/worker/dist
COPY --from=base /app/packages/core/dist ./packages/core/dist
COPY --from=base /app/packages/shared/dist ./packages/shared/dist

# Set working directory to worker
WORKDIR /app/packages/worker

# Run the worker
CMD ["node", "dist/index.js"]
