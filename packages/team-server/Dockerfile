FROM node:22-alpine AS builder
WORKDIR /app
RUN corepack enable pnpm

# Copy workspace config
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json ./
COPY tsconfig.base.json ./

# Copy packages needed for build
COPY packages/parser/ packages/parser/
COPY packages/team-server/ packages/team-server/

RUN pnpm install --frozen-lockfile
RUN pnpm -F @claude-lens/team-server build

FROM node:22-alpine AS runner
WORKDIR /app

# Copy standalone output
COPY --from=builder /app/packages/team-server/.next/standalone ./
COPY --from=builder /app/packages/team-server/.next/static ./packages/team-server/.next/static
COPY --from=builder /app/packages/team-server/src/db/schema.sql ./packages/team-server/src/db/schema.sql

ENV PORT=3322
ENV HOSTNAME=0.0.0.0
EXPOSE 3322

CMD ["node", "packages/team-server/server.js"]
