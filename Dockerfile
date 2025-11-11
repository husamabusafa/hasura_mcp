FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./

RUN npm ci

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

FROM node:20-alpine AS runner

ENV NODE_ENV=production

WORKDIR /app

COPY package.json package-lock.json ./

RUN npm ci --omit=dev
RUN npm install -g pnpm
RUN pnpm install


COPY --from=builder /app/dist ./dist

# Default command can be overridden to pass Hasura endpoint and admin secret:
# docker run ... mcp-hasura npm start -- <endpoint> [admin_secret]
CMD ["node", "dist/index.js"]


