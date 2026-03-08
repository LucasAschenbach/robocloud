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
COPY packages/robot-agent-ts/package.json packages/robot-agent-ts/tsconfig.json packages/robot-agent-ts/
COPY packages/sdk/package.json packages/sdk/tsconfig.json packages/sdk/
RUN pnpm install --frozen-lockfile

COPY packages/shared/ packages/shared/
COPY packages/api/ packages/api/
COPY packages/simulator/ packages/simulator/
COPY packages/robot-agent-ts/ packages/robot-agent-ts/
COPY packages/sdk/ packages/sdk/
RUN pnpm run build

FROM base AS api
WORKDIR /app
COPY --from=build /app .
EXPOSE 3000
CMD ["node", "packages/api/dist/server.js"]

FROM base AS robot-agent-ts
WORKDIR /app
COPY --from=build /app .
CMD ["node", "packages/robot-agent-ts/dist/agent.js"]

# ── Python MuJoCo Agent ─────────────────────────────────────────────────────
FROM python:3.12-slim AS python-agent-base
RUN apt-get update && apt-get install -y --no-install-recommends \
    libegl1-mesa libgl1-mesa-glx libosmesa6 libglfw3 \
    && rm -rf /var/lib/apt/lists/*

FROM python-agent-base AS python-agent
WORKDIR /app
COPY packages/robot-agent-py/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY packages/robot-agent-py/ .
RUN pip install --no-cache-dir -e .
ENV MUJOCO_GL=osmesa
CMD ["python", "-m", "robocloud_agent.main"]
