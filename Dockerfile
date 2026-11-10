FROM node:22-bookworm-slim
ENV DEBIAN_FRONTEND=noninteractive PYTHONUNBUFFERED=1 PLAYWRIGHT_BROWSERS_PATH=/ms-playwright PROJECTS_DIR=/data/projects EXPORTS_DIR=/data/exports
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-pip ffmpeg ca-certificates fonts-liberation libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2 libpango-1.0-0 libcairo2 libxshmfence1 && rm -rf /var/lib/apt/lists/*
COPY certs/corp-root.crt /usr/local/share/ca-certificates/corp-root.crt
RUN update-ca-certificates
ENV NODE_EXTRA_CA_CERTS=/usr/local/share/ca-certificates/corp-root.crt
ENV npm_config_cafile=/usr/local/share/ca-certificates/corp-root.crt
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --verbose
RUN npx playwright install --with-deps chromium
COPY requirements.txt ./
RUN pip3 install --no-cache-dir --break-system-packages -r requirements.txt
COPY app ./app
COPY engine ./engine
COPY scripts ./scripts
RUN mkdir -p /data/projects /data/exports && useradd -m -u 10001 studio && chown -R studio:studio /app /data
USER studio
EXPOSE 3000
CMD ["uvicorn","app.main:app","--host","0.0.0.0","--port","3000"]
