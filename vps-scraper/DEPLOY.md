# Deploying Aigenic Scraper on a Contabo VPS

This walkthrough takes you from a fresh Ubuntu 22.04+ VPS to `https://scraper.yourdomain.com/health` returning `{"status":"ok"}`. Total time: 15–20 minutes.

> The instructions use Caddy as the reverse proxy because it gets you HTTPS via Let's Encrypt with one config line. There's an Nginx variant at the bottom if you prefer it.

---

## 1. SSH into the VPS

```bash
ssh root@<your-contabo-ip>
```

(Or your non-root sudo user — the rest of this guide assumes `root` for brevity; add `sudo` in front of each command if you're using a regular user.)

Create a non-root user for the service if you don't already have one:

```bash
adduser deploy
usermod -aG sudo deploy
rsync --archive --chown=deploy:deploy ~/.ssh /home/deploy
su - deploy
```

---

## 2. Install Docker + Docker Compose plugin

```bash
# remove any stale Docker packages
sudo apt-get remove -y docker docker-engine docker.io containerd runc || true

sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg

sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | \
  sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# allow your user to run docker without sudo
sudo usermod -aG docker $USER
newgrp docker

# verify
docker version
docker compose version
```

---

## 3. Clone the repo & install the scraper

```bash
cd ~
git clone https://github.com/<you>/aigenic.git
cd aigenic/vps-scraper
```

(If you don't have the repo on GitHub yet, `scp` the `vps-scraper/` directory up: `scp -r vps-scraper deploy@<vps-ip>:~/`.)

---

## 4. Generate and set the API key

The Next.js app and the scraper share a single secret. Generate one and use it in **both** environments.

```bash
# on the VPS
openssl rand -hex 32
# copy the output — call this $SCRAPER_API_KEY
```

Put it in a local `.env` file next to `docker-compose.yml`:

```bash
cat > .env <<'EOF'
SCRAPER_API_KEY=PASTE_THE_OPENSSL_OUTPUT_HERE
EOF
chmod 600 .env
```

In your Next.js app's Vercel project (or `.env.local`), set the matching pair:

```env
SCRAPER_API_URL=https://scraper.yourdomain.com
SCRAPER_API_KEY=PASTE_THE_OPENSSL_OUTPUT_HERE
```

---

## 5. Build and start the service

```bash
docker compose up -d --build
docker compose logs -f
```

You should see something like:

```
aigenic-scraper {"level":30,"port":3007,"msg":"aigenic-scraper listening"}
```

The container is bound to `127.0.0.1:3007` — it isn't reachable from the internet yet. That's intentional. We let Caddy terminate TLS and proxy to it.

Quick local check:

```bash
curl http://127.0.0.1:3007/health
# {"status":"ok","service":"aigenic-scraper","uptime":...}
```

---

## 6. Point a DNS A record

In your domain registrar (Cloudflare, Namecheap, etc.):

```
Type:  A
Name:  scraper
Value: <your-contabo-ipv4>
TTL:   300
Proxy: off  (if Cloudflare — let Caddy do TLS)
```

Wait for propagation:

```bash
dig +short scraper.yourdomain.com
# should print your VPS IP
```

---

## 7. Install Caddy and configure HTTPS

```bash
sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https

curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | \
  sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg

curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | \
  sudo tee /etc/apt/sources.list.d/caddy-stable.list

sudo apt-get update
sudo apt-get install -y caddy
```

Edit `/etc/caddy/Caddyfile`:

```caddyfile
scraper.yourdomain.com {
    encode zstd gzip
    reverse_proxy 127.0.0.1:3007

    # Health endpoint is public — everything else is API-key-gated by the app.
    log {
        output file /var/log/caddy/scraper.log
        format console
    }
}
```

Reload Caddy:

```bash
sudo systemctl reload caddy
sudo systemctl status caddy --no-pager
```

Caddy will request a Let's Encrypt cert automatically on the first request.

---

## 8. Verify end-to-end

From your laptop:

```bash
curl https://scraper.yourdomain.com/health
# {"status":"ok","service":"aigenic-scraper","uptime":12.3}
```

Bad-key check:

```bash
curl -i -X POST https://scraper.yourdomain.com/crawl \
  -H "Content-Type: application/json" \
  -d '{}'
# HTTP/2 401
# {"error":"Unauthorized"}
```

Real crawl (replace siteId + webhookUrl with a webhook.site bin to inspect the callback):

```bash
curl -i -X POST https://scraper.yourdomain.com/crawl \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $SCRAPER_API_KEY" \
  -d '{
    "siteId":"00000000-0000-0000-0000-000000000000",
    "startUrl":"https://example.com",
    "maxPages":5,
    "webhookUrl":"https://webhook.site/<your-bin>"
  }'
# HTTP/2 202
# {"jobId":"…","siteId":"…","status":"queued"}
```

Watch `webhook.site` — `article` events should arrive, followed by `complete`.

---

## 9. Wire it into the Aigenic app

In your Next.js project's Vercel env vars (Production and Preview):

```env
SCRAPER_API_URL=https://scraper.yourdomain.com
SCRAPER_API_KEY=<same as on the VPS>
```

Redeploy. Adding a new site from the dashboard should now trigger a real crawl.

---

## 10. Day-2 operations

| Task                       | Command                                           |
| -------------------------- | ------------------------------------------------- |
| Check status               | `docker compose ps`                               |
| Follow logs                | `docker compose logs -f --tail=200 scraper`       |
| Restart                    | `docker compose restart scraper`                  |
| Pull latest code + rebuild | `git pull && docker compose up -d --build`        |
| See resource use           | `docker stats aigenic-scraper`                  |
| Update Caddy config        | `sudo caddy reload --config /etc/caddy/Caddyfile` |

If the box runs out of memory during a large crawl, raise `deploy.resources.limits.memory` in `docker-compose.yml` (Contabo's smallest plan handles ~1.5 GB comfortably) or lower `CONCURRENCY` in `src/crawler.ts`.

---

## Appendix — Nginx instead of Caddy

If you'd rather use Nginx + Certbot:

```nginx
# /etc/nginx/sites-available/scraper
server {
    listen 80;
    server_name scraper.yourdomain.com;

    location / {
        proxy_pass http://127.0.0.1:3007;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 90s;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/scraper /etc/nginx/sites-enabled/scraper
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d scraper.yourdomain.com
```

Certbot adds the HTTPS server block and the renewal cron — done.
