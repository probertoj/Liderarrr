# --- build del frontend -----------------------------------------------------
FROM node:24-slim AS web
WORKDIR /app
COPY package.json package-lock.json* ./
COPY web/package.json web/
RUN npm install --workspace web --include-workspace-root
COPY web/ web/
RUN npm run build --workspace web

# --- dependencias del servidor (compila better-sqlite3 aquí) ----------------
# Se compila el módulo nativo en una etapa con toolchain y luego solo se copia
# node_modules a la imagen final, que así no arrastra gcc/python.
FROM node:24-slim AS deps
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json* ./
COPY server/package.json server/
RUN npm install --workspace server --include-workspace-root --omit=dev

# --- imagen final -----------------------------------------------------------
FROM node:24-slim
WORKDIR /app

# fpcalc (Chromaprint) es imprescindible para AcoustID: saca la huella acústica
# del audio real. Sin él, la identificación cae en la búsqueda por texto.
RUN apt-get update \
  && apt-get install -y --no-install-recommends libchromaprint-tools ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
COPY server/package.json server/
COPY --from=deps /app/node_modules ./node_modules
COPY server/ server/
COPY --from=web /app/web/dist web/dist
COPY docker-entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

ENV NODE_ENV=production
ENV DATA_DIR=/data
ENV PORT=3861
VOLUME /data
EXPOSE 3861

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
  CMD node -e "fetch('http://127.0.0.1:3861/api/version').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["entrypoint.sh"]
CMD ["node", "server/src/index.js"]
