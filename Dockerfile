# syntax=docker/dockerfile:1

FROM node:22-alpine AS build
WORKDIR /app

COPY app/package*.json ./
RUN npm ci

COPY app/ ./
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8787

COPY --from=build /app/dist ./dist
COPY --from=build /app/server.js ./server.js
COPY app/package*.json ./

EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT}/health >/dev/null || exit 1

CMD ["node", "server.js"]
