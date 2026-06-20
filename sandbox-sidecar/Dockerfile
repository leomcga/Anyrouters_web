FROM node:22-slim

WORKDIR /app

# Install deps first for layer caching.
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY server.mjs ./

ENV PORT=8080
EXPOSE 8080

CMD ["node", "server.mjs"]
