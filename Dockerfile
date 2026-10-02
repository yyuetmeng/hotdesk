# Hot Desk Monitor container image.
# Build:  docker build -t hotdesk .
# Run:    docker run -p 3000:3000 -v hotdesk-data:/data -e ADMIN_TOKEN=... -e SENSOR_API_KEY=... hotdesk
FROM node:22-alpine

ENV NODE_ENV=production \
    PORT=3000 \
    STATE_FILE=/data/state.json

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src
COPY public ./public
COPY config ./config
COPY scripts ./scripts

# Desk state (check-ins, sensor links, history) lives on a volume so it survives upgrades.
RUN mkdir -p /data && chown node:node /data
VOLUME /data
USER node

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

CMD ["node", "src/index.js"]
