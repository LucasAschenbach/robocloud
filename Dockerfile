FROM node:20-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

FROM base AS build
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/tsconfig.json packages/shared/
COPY packages/api/package.json packages/api/tsconfig.json packages/api/
COPY packages/simulator/package.json packages/simulator/tsconfig.json packages/simulator/
COPY packages/robot-agent/package.json packages/robot-agent/tsconfig.json packages/robot-agent/
COPY packages/sdk/package.json packages/sdk/tsconfig.json packages/sdk/
RUN pnpm install --frozen-lockfile

COPY packages/shared/ packages/shared/
COPY packages/api/ packages/api/
COPY packages/simulator/ packages/simulator/
COPY packages/robot-agent/ packages/robot-agent/
COPY packages/sdk/ packages/sdk/
RUN pnpm run build

FROM base AS api
WORKDIR /app
COPY --from=build /app .
EXPOSE 3000
CMD ["node", "packages/api/dist/server.js"]

FROM base AS robot-agent
WORKDIR /app
COPY --from=build /app .
CMD ["node", "packages/robot-agent/dist/agent.js"]
