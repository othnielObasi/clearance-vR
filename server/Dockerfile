FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev --ignore-scripts --no-audit --no-fund
COPY src ./src
USER node
ENV PORT=8787
EXPOSE 8787
CMD ["node", "src/index.js"]
