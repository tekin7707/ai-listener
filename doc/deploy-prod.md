## nginx/conf.d/platform.conf


server {
    listen 80;
    server_name agentechauth.com api.agentechauth.com poc.agentechauth.com fiload.agentechauth.com;

    location / {
        return 301 https://$host$request_uri;
    }
}

server {
    listen 443 ssl;
    server_name agentechauth.com api.agentechauth.com poc.agentechauth.com;

    ssl_certificate /etc/nginx/certs/agentechauth.com/fullchain.pem;
    ssl_certificate_key /etc/nginx/certs/agentechauth.com/privkey.pem;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    location / {
        proxy_pass http://agentechauth_web:80;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_http_version 1.1;
    }
}

server {
    listen 443 ssl;
    server_name fiload.agentechauth.com;

    ssl_certificate /etc/nginx/certs/agentechauth.com/fullchain.pem;
    ssl_certificate_key /etc/nginx/certs/agentechauth.com/privkey.pem;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    client_max_body_size 15m;
    proxy_read_timeout 120s;
    proxy_send_timeout 120s;

    location / {
        proxy_pass http://fiload_api:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_http_version 1.1;
    }
}


## docker-compose.yml

name: edge

services:
  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx/conf.d:/etc/nginx/conf.d:ro
      - ./certs:/etc/nginx/certs:ro
      - ./logs:/var/log/nginx
    networks:
      - edge
    restart: always

networks:
  edge:
    external: true
    name: ${EDGE_NETWORK_NAME:-edge_web}



## .github/workflows/deploy.yml

name: Deploy Edge to VPS

on:
  workflow_dispatch:

jobs:
  deploy:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Ensure target directories exist
        uses: appleboy/ssh-action@v1.0.3
        with:
          host: ${{ secrets.VPS_HOST }}
          username: ${{ secrets.VPS_USER }}
          key: ${{ secrets.VPS_SSH_KEY }}
          port: ${{ secrets.VPS_PORT }}
          script: |
            set -e
            mkdir -p /home/deploy/hetzner01/edge/nginx/conf.d
            mkdir -p /home/deploy/hetzner01/edge/certs/agentechauth.com
            mkdir -p /home/deploy/hetzner01/edge/logs
            docker network inspect edge_web >/dev/null 2>&1 || docker network create edge_web

      - name: Sync runtime files to VPS
        uses: appleboy/scp-action@v0.1.7
        with:
          host: ${{ secrets.VPS_HOST }}
          username: ${{ secrets.VPS_USER }}
          key: ${{ secrets.VPS_SSH_KEY }}
          port: ${{ secrets.VPS_PORT }}
          source: "docker-compose.yml,nginx,scripts"
          target: "/home/deploy/hetzner01/edge"
          rm: false
          overwrite: true
          strip_components: 0
          tar_dereference: true

      - name: SSH to VPS and deploy
        uses: appleboy/ssh-action@v1.0.3
        with:
          host: ${{ secrets.VPS_HOST }}
          username: ${{ secrets.VPS_USER }}
          key: ${{ secrets.VPS_SSH_KEY }}
          port: ${{ secrets.VPS_PORT }}
          script: |
            set -e

            cd /home/deploy/hetzner01/edge
            rm -rf .git

            EXISTING_CERT_DIR="/home/deploy/hetzner01/edge/certs/agentechauth.com"
            LEGACY_CERT_DIR="/home/deploy/app/nginx/certs/agentechauth.com"

            if [ -r "$EXISTING_CERT_DIR/fullchain.pem" ] && [ -r "$EXISTING_CERT_DIR/privkey.pem" ]; then
              echo "Using existing certificates from $EXISTING_CERT_DIR"
            elif [ -r "$LEGACY_CERT_DIR/fullchain.pem" ] && [ -r "$LEGACY_CERT_DIR/privkey.pem" ]; then
              cp "$LEGACY_CERT_DIR/fullchain.pem" ./certs/agentechauth.com/fullchain.pem
              cp "$LEGACY_CERT_DIR/privkey.pem" ./certs/agentechauth.com/privkey.pem
            elif [ -r /etc/letsencrypt/live/agentechauth.com/fullchain.pem ] && [ -r /etc/letsencrypt/live/agentechauth.com/privkey.pem ]; then
              cp /etc/letsencrypt/live/agentechauth.com/fullchain.pem ./certs/agentechauth.com/fullchain.pem
              cp /etc/letsencrypt/live/agentechauth.com/privkey.pem ./certs/agentechauth.com/privkey.pem
            else
              echo "Readable certificate source not found for agentechauth.com; bootstrap /home/deploy/hetzner01/edge/certs/agentechauth.com manually once" >&2
              exit 1
            fi

            chmod 644 ./certs/agentechauth.com/fullchain.pem
            chmod 600 ./certs/agentechauth.com/privkey.pem

            EDGE_NETWORK_NAME=edge_web docker compose up -d --build


## nginx/default.conf

server {
    listen 80;
    server_name agentechauth.com;

    location / {
        proxy_pass http://frontend:80;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

server {
    listen 80;
    server_name api.agentechauth.com;

    location / {
        proxy_pass http://api:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

server {
    listen 80;
    server_name poc.agentechauth.com;

    location / {
        proxy_pass http://poc:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}


## .github/workflows/deploy.yml

name: Deploy Fiload to VPS

on:
  push:
    branches:
      - main
  workflow_dispatch:

jobs:
  deploy:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Ensure target directories exist
        uses: appleboy/ssh-action@v1.0.3
        with:
          host: ${{ secrets.VPS_HOST }}
          username: ${{ secrets.VPS_USER }}
          key: ${{ secrets.VPS_SSH_KEY }}
          port: ${{ secrets.VPS_PORT }}
          script: |
            set -e
            mkdir -p /home/deploy/hetzner01/fiload/releases/current
            mkdir -p /home/deploy/hetzner01/fiload/storage
            docker network inspect edge_web >/dev/null 2>&1 || docker network create edge_web

      - name: Sync runtime files to VPS
        uses: appleboy/scp-action@v0.1.7
        with:
          host: ${{ secrets.VPS_HOST }}
          username: ${{ secrets.VPS_USER }}
          key: ${{ secrets.VPS_SSH_KEY }}
          port: ${{ secrets.VPS_PORT }}
          source: "Dockerfile,docker-compose.yml,index.js,package.json,public,.env.example,.dockerignore,web.config"
          target: "/home/deploy/hetzner01/fiload/releases/current"
          rm: false
          overwrite: true
          strip_components: 0
          tar_dereference: true

      - name: SSH to VPS and deploy
        uses: appleboy/ssh-action@v1.0.3
        with:
          host: ${{ secrets.VPS_HOST }}
          username: ${{ secrets.VPS_USER }}
          key: ${{ secrets.VPS_SSH_KEY }}
          port: ${{ secrets.VPS_PORT }}
          script: |
            set -e

            cd /home/deploy/hetzner01/fiload/releases/current
            rm -rf .git

            if [ ! -f .env ]; then
              cp .env.example .env
            fi

            EDGE_NETWORK_NAME=edge_web FILOAD_STORAGE_PATH=/home/deploy/hetzner01/fiload/storage docker compose up -d --build