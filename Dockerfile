# Production Build Stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy dependency manifests
COPY package*.json ./

# Install all dependencies including devDependencies (needed for building search/Vite client)
RUN npm ci

# Copy application source files
COPY . .

# Build the client static bundle (outputs to dist/)
RUN npm run build

# --- Runtime Stage ---
FROM node:20-alpine AS runner

WORKDIR /app

# Set production environment flags
ENV NODE_ENV=production
ENV PORT=3000

# Copy package manifests & install only production dependencies
COPY package*.json ./
RUN npm ci --only=production

# Install 'tsx' globally to run the TypeScript Express backend directly on Cloud Run
RUN npm install -g tsx

# Copy source code and pre-compiled client bundle from builder
COPY . .
COPY --from=builder /app/dist ./dist

# Expose HTTP port
EXPOSE 3000

# Start Express server via tsx
CMD ["tsx", "server.ts"]
