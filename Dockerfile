# syntax=docker/dockerfile:1

# --- build stage: compiles the Angular app against environment.prod.ts (see angular.json's
# fileReplacements) ---
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build -- --configuration production

# --- runtime stage: static file server only, no Node/Angular toolchain in the final image ---
FROM node:24-slim
WORKDIR /app
RUN npm install -g serve@14

# Pure client-side-routed SPA (no @angular/ssr, no server.ts anywhere in this repo) — `serve -s`
# rewrites unmatched paths to index.html so refreshing on e.g. /orders doesn't 404.
COPY --from=build /app/dist/godhan-admin/browser ./browser

# Railway injects PORT at runtime; default 3000 covers a local `docker run` with no PORT set.
CMD ["sh", "-c", "serve -s browser -l tcp://0.0.0.0:${PORT:-3000}"]
