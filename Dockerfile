FROM node:20-alpine

WORKDIR /app

# Copy package files and install production dependencies only
COPY package*.json ./
RUN npm install --omit=dev

# Copy the rest of the application
COPY . .

EXPOSE 3000

CMD ["node", "server.js"]
