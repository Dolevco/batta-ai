FROM node:24-alpine AS builder

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy workspace files
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/ui/package.json ./packages/ui/

# Install dependencies
RUN pnpm install --frozen-lockfile --ignore-scripts

# Copy source code
COPY packages/ui ./packages/ui
COPY tsconfig.json ./

# Build-time env vars (Vite bakes these in at build time)
ARG VITE_AUTH_DISABLED=false
ENV VITE_AUTH_DISABLED=$VITE_AUTH_DISABLED

# Build UI
RUN pnpm --filter @batta/ui build

# Copy images to dist (they need to be in the build output)
RUN cp -r packages/ui/images packages/ui/dist/

# Production stage - use nginx to serve static files
FROM nginx:alpine

# Copy built files
COPY --from=builder /app/packages/ui/dist /usr/share/nginx/html

# Copy both nginx configurations to a temp location
COPY deploy/ui/nginx.conf /tmp/nginx-http.conf
COPY deploy/ui/nginx-https.conf /tmp/nginx-https.conf

# Copy entrypoint script
COPY deploy/ui/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# Remove default config
RUN rm -f /etc/nginx/conf.d/default.conf

# Expose ports
EXPOSE 80
EXPOSE 443

# Start with entrypoint script
CMD ["/docker-entrypoint.sh"]
