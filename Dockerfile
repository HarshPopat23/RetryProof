FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:24-bookworm-slim
ENV NODE_ENV=production RP_TRANSPORT=http RP_HOST=0.0.0.0 RP_DATA_DIR=/app/data
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && mkdir -p /app/data && chown node:node /app/data
COPY --from=build /app/dist ./dist
USER node
VOLUME ["/app/data"]
EXPOSE 3000
CMD ["node", "dist/index.js"]
