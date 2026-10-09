# SENTER — سنتر: Node 22+ فقط (لا توجد حزم npm)
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000 DB_FILE=/data/senter.db UPLOAD_DIR=/data/uploads BACKUP_DIR=/data/backups
COPY package.json ./
COPY src ./src
COPY public ./public
COPY scripts ./scripts
RUN mkdir -p /data && chown -R node:node /data /app
USER node
VOLUME ["/data"]
EXPOSE 3000
CMD ["node", "--no-warnings", "src/server.js"]
