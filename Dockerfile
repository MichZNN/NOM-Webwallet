# syntax=docker/dockerfile:1
# Fork addition: container image for the web app (build with Node, serve with nginx).

FROM node:22.12-alpine AS build
WORKDIR /app
# git is needed for the github: dependency (nom-ui)
RUN apk add --no-cache git
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM nginx:1.27-alpine
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY docker/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO /dev/null http://127.0.0.1:8080/healthz || exit 1
