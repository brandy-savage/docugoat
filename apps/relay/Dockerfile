FROM node:22-alpine
RUN apk add --no-cache git
WORKDIR /app
COPY package.json package-lock.json* ./
COPY apps/relay/package.json apps/relay/
RUN npm ci --workspace apps/relay --omit=dev --ignore-scripts
COPY apps/relay/src apps/relay/src
COPY apps/relay/tsconfig.json apps/relay/
WORKDIR /app/apps/relay
ENV NODE_ENV=production PORT=4173
# ALLOWED_ORIGINS=https://<user>.github.io  — comma-separated list of origins allowed to call this relay
VOLUME ["/app/apps/relay/data"]
EXPOSE 4173
CMD ["npx", "tsx", "src/index.ts"]
