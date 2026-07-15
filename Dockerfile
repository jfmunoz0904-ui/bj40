# Stage 1: Build
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .

# Stage 2: Production
FROM node:20-alpine
LABEL maintainer="SRE Team <sre@yovannybingo.com>"
ENV NODE_ENV=production
WORKDIR /app

COPY --from=builder /app/package*.json ./
RUN npm install --omit=dev && npm cache clean --force

COPY --from=builder /app/*.js ./
COPY --from=builder /app/public ./public

USER node
EXPOSE 3000

CMD ["node", "server.js"]