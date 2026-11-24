# Stage 1: Build React + Vite Frontend
FROM node:22-slim AS frontend-builder
WORKDIR /app/omnirag-frontend
COPY omnirag-frontend/package*.json ./
RUN npm ci
COPY omnirag-frontend/ ./
RUN npm run build

# Stage 2: Production Backend + Python Voice Sidecar + Media Tools + Built Frontend
FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-venv \
    python3-pip \
    ffmpeg \
    curl \
    ca-certificates \
  && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
  && chmod a+rx /usr/local/bin/yt-dlp \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Node.js production dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Install Python Voice Sidecar dependencies in an isolated Linux venv
COPY voice-service/requirements.txt ./voice-service/requirements.txt
RUN python3 -m venv /app/voice-service/.venv \
  && /app/voice-service/.venv/bin/pip install --no-cache-dir --upgrade pip \
  && /app/voice-service/.venv/bin/pip install --no-cache-dir -r /app/voice-service/requirements.txt

# Copy application source & compiled frontend
COPY . .
COPY --from=frontend-builder /app/omnirag-frontend/dist ./omnirag-frontend/dist

# Strip Windows CRLF line endings from start.sh and make it executable
RUN sed -i 's/\r$//' /app/start.sh && chmod +x /app/start.sh

EXPOSE 3000

CMD ["/app/start.sh"]