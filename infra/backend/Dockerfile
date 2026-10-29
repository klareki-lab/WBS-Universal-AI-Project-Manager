FROM node:24-alpine AS build
WORKDIR /app/apps/backend
COPY package*.json ./
RUN npm ci
COPY tsconfig*.json ./
COPY src/ ./src/
COPY scripts/ ./scripts/
COPY migrations/ ./migrations/
RUN npm run build && npm prune --omit=dev
FROM node:24-alpine
WORKDIR /app/apps/backend
COPY --from=build --chown=node:node /app/apps/backend/node_modules ./node_modules
COPY --from=build --chown=node:node /app/apps/backend/dist ./dist
COPY --from=build --chown=node:node /app/apps/backend/migrations ./dist/apps/backend/migrations
COPY --from=build --chown=node:node /app/apps/backend/package.json ./package.json
USER node
CMD ["node", "dist/apps/backend/src/server.js"]
