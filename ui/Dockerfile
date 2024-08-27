FROM node:latest AS builder

WORKDIR /usr/src/app

COPY public/fonts ./public/fonts
COPY src ./src
COPY index.html ./
COPY package-lock.json ./
COPY package.json ./
COPY tsconfig.json ./
COPY tsconfig.node.json ./
COPY vite.config.ts ./

RUN npm install

RUN npm run build

# Stage 2: Serve the built files with Caddy
FROM caddy:latest

COPY --from=builder /usr/src/app/dist /srv

#FROM nginx:alpine
#COPY --from=0 /usr/src/app/dist /usr/share/nginx/html
EXPOSE 80

#CMD ["nginx", "-g", "daemon off;"]
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]