FROM node:22-alpine
RUN apk add --no-cache git
WORKDIR /app
COPY package.json package-lock.json* ./
COPY server/package.json server/
RUN npm ci --workspace server --omit=dev --ignore-scripts
COPY server/src server/src
COPY server/tsconfig.json server/
WORKDIR /app/server
ENV NODE_ENV=production PORT=4173
# ALLOWED_ORIGINS=https://<user>.github.io  — comma-separated list of origins allowed to call this relay
VOLUME ["/app/server/data"]
EXPOSE 4173
CMD ["npx", "tsx", "src/index.ts"]
