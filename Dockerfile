FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package.json ./
COPY server.js index.html ./
COPY server ./server
COPY src ./src
COPY data ./data
COPY database ./database

EXPOSE 8080
CMD ["node", "server.js"]
