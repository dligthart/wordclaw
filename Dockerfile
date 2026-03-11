FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
WORKDIR /app
COPY tsconfig.json ./
COPY src ./src
COPY drizzle ./drizzle
RUN npm run build

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

COPY --from=build /app/dist ./dist
COPY drizzle ./drizzle
COPY docker/entrypoint.sh /usr/local/bin/wordclaw-entrypoint

RUN chmod +x /usr/local/bin/wordclaw-entrypoint

EXPOSE 4000

ENTRYPOINT ["wordclaw-entrypoint"]
