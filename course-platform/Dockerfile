FROM node:24-alpine

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --include=dev
COPY . .
RUN npm run build \
    && mkdir -p /app/server/data/uploads \
    && chown -R node:node /app/server/data

ENV NODE_ENV=production \
    DEMO_MODE=false \
    PORT=4310 \
    DATABASE_PATH=/app/server/data/courses.sqlite \
    UPLOAD_DIR=/app/server/data/uploads

USER node
EXPOSE 4310
CMD ["node", "server/index.js"]
