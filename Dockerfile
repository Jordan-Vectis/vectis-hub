FROM node:22.12.0-alpine

WORKDIR /app

ARG BIDJS_NPM_TOKEN

COPY package*.json ./
RUN echo "@bidlogixteam:registry=https://npm.pkg.github.com/" > .npmrc && \
    echo "//npm.pkg.github.com/:_authToken=${BIDJS_NPM_TOKEN}" >> .npmrc && \
    npm ci && \
    rm .npmrc

COPY . .

ENV NODE_ENV=production
ENV NODE_OPTIONS="--max-old-space-size=2048"
RUN npm run build

EXPOSE 3000
CMD ["npm", "run", "start"]
