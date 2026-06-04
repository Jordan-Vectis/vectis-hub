FROM node:22.12.0-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

ENV NODE_ENV=production
ENV NODE_OPTIONS="--max-old-space-size=2048"
RUN npm run build

EXPOSE 3000
CMD ["npm", "run", "start"]
