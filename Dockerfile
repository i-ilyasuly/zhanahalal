# Base Image (Debian-based Node 20 is extremely stable for compiling all native dependencies)
FROM node:20

WORKDIR /app

# Copy package manifests first to leverage Docker layer caching
COPY package*.json ./

# Install all dependencies (allows auto-resolution of small lockfile mismatches)
RUN npm install --legacy-peer-deps

# Copy the rest of the application files
COPY . .

# Build the static React frontend client (outputs to dist/)
RUN npm run build

# Expose HTTP port for Cloud Run (Cloud Run sets the PORT env variable automatically, e.g., 8080)
EXPOSE 3000

# Set production flags and defaults
ENV NODE_ENV=production
ENV PORT=3000

# Start Express server via local devDependencies 'tsx' using npx
CMD ["npx", "tsx", "server.ts"]
