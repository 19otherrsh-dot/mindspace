# Build context should be the monorepo root
# docker build -f apps/api/Dockerfile -t mindspace-api .

FROM node:20-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

FROM base AS builder
# Set working directory
WORKDIR /app
COPY . .
# Install dependencies
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

# Build shared package and api
RUN pnpm --filter @mindspace/shared build || true
RUN pnpm --filter @mindspace/api build

# Prune dev dependencies
RUN pnpm --filter @mindspace/api --prod deploy pruned

FROM base AS runner
WORKDIR /app

# Copy the pruned app and shared dependencies
COPY --from=builder /app/pruned/ .

# Production env
ENV NODE_ENV=production
ENV PORT=4000

EXPOSE 4000
CMD ["node", "dist/index.js"]
