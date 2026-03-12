FROM oven/bun:1.1.38-slim AS base
WORKDIR /app
ENV NODE_ENV="production"

# Install dependencies
COPY package.json bun.lockb* ./
RUN bun install --frozen-lockfile --production 2>/dev/null || bun install --production

# Copy source
COPY . .

# Build client script
RUN bun build src/client/t.ts --outdir dist --minify

RUN mkdir -p /data

EXPOSE 3000
CMD ["bun", "run", "src/server/index.ts"]
