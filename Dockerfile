FROM node:lts-slim

WORKDIR /app
COPY package*.json /app/
RUN npm ci

COPY config.json /app/
COPY index.js /app/
COPY sound /app/

CMD ["node", "index.js"]
