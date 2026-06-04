FROM node:22.12.0-alpine

WORKDIR /app

ARG BIDJS_NPM_TOKEN
ENV BIDJS_NPM_TOKEN=$BIDJS_NPM_TOKEN

COPY package*.json .npmrc ./
RUN npm ci

COPY . .

ENV NODE_ENV=production
ENV NODE_OPTIONS="--max-old-space-size=2048"
RUN npm run build

EXPOSE 3000
CMD ["npm", "run", "start"]
