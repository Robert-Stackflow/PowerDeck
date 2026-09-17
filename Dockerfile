FROM node:22-bookworm-slim AS dependencies

WORKDIR /app
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4173 \
    EXPORT_CHROMIUM_PATH=/usr/bin/chromium \
    SOFFICE_PATH=/usr/bin/soffice

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      ca-certificates \
      chromium \
      fonts-liberation \
      fonts-noto-cjk \
      libreoffice-impress \
      tini \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY --chown=node:node . .

RUN npm run build \
    && mkdir -p /app/data \
    && chown -R node:node /app/data

USER node
EXPOSE 4173

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "--env-file-if-exists=.env", "server/app.mjs"]
