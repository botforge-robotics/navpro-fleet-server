# NavPro fleet edge: GUI static bundle + nginx reverse proxy in ONE image.
# Build from navpro-fleet-server root:
#   docker compose build nginx

FROM node:22-alpine AS gui-build
WORKDIR /app

COPY web-gui/package.json web-gui/package-lock.json* ./
RUN npm install

COPY web-gui/tsconfig.json \
     web-gui/tsconfig.app.json \
     web-gui/tsconfig.node.json \
     web-gui/vite.config.ts \
     web-gui/index.html \
     web-gui/uidesign.json \
     web-gui/NOTICE \
     ./
COPY web-gui/src ./src
COPY web-gui/packages ./packages

RUN npm run build

FROM nginx:1.27-alpine
COPY nginx/nginx.conf /etc/nginx/nginx.conf
COPY --from=gui-build /app/dist /usr/share/nginx/html
EXPOSE 80
