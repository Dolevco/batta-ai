FROM node:24-alpine AS builder

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy workspace files
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/ui/package.json ./packages/ui/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY packages/ui ./packages/ui
COPY tsconfig.json ./

# Build UI
RUN pnpm --filter @ai-agent/ui build

# Copy images to dist (they need to be in the build output)
RUN cp -r packages/ui/images packages/ui/dist/

# Production stage - use nginx to serve static files
FROM nginx:alpine

# Copy built files
COPY --from=builder /app/packages/ui/dist /usr/share/nginx/html

# Copy both nginx configurations to a temp location
COPY packages/ui/nginx.conf /tmp/nginx-http.conf
COPY packages/ui/nginx-https.conf /tmp/nginx-https.conf

# Copy entrypoint script
COPY packages/ui/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# Remove default config
RUN rm -f /etc/nginx/conf.d/default.conf

# Expose ports
EXPOSE 80
EXPOSE 443

# Start with entrypoint script
CMD ["/docker-entrypoint.sh"]
