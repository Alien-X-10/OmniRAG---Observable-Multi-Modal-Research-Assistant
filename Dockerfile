# Stage 1: Build React + Vite Frontend
FROM node:22-slim AS frontend-builder
WORKDIR /app/omnirag-frontend
COPY omnirag-frontend/package*.json ./
RUN npm ci
COPY omnirag-frontend/ ./
RUN npm run build

# Stage 2: Production Backend + Media Tools + Built Frontend
FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    ffmpeg \
    curl \
    ca-certificates \
  && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
  && chmod a+rx /usr/local/bin/yt-dlp \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .
COPY --from=frontend-builder /app/omnirag-frontend/dist ./omnirag-frontend/dist

EXPOSE 3000

CMD ["node", "src/server.js"]