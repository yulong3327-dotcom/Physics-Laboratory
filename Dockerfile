ARG NODE_VERSION=24
FROM image-docker.zuoyebang.cc/base/node:${NODE_VERSION}-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --include=dev
COPY . .
RUN npm run build

FROM image-docker.zuoyebang.cc/base/node:${NODE_VERSION}-slim
ARG CI_FE_DEBUG
ARG APP_NAME
ENV APP_NAME=$APP_NAME \
    NODE_ENV=production \
    PORT=8080
WORKDIR /app
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/dist ./dist
COPY --from=build /app/server-dist ./server-dist
EXPOSE 8080
CMD ["node", "server-dist/index.js"]
