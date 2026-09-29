# Deploying ScousGiftCardExchange on your own VPS

The whole site runs in one container. Member accounts, trades, balances and
card photos live in your own Cloudflare storage (the D1 database and the
`scous-proofs` file bucket); the container simply talks to them, so you can run
the same image anywhere without moving data.

## 1. Requirements

- A VPS with Docker and the Docker Compose plugin
  (`curl -fsSL https://get.docker.com | sh`)
- Your domain pointed at the server's IP
- At least 2 GB RAM for the build step

## 2. Get the code and the settings

```bash
git clone <your-repo-url> scous
cd scous
cp .env.example .env
nano .env        # fill in every value
```

`.env` holds everything the app needs: your Cloudflare account and database
identifiers, the two access keys, the file bucket name, the sign-in cookie key,
the mail server details, the sender identity, the public site address and the
port.

## 2b. Check the database is reachable

```bash
curl -s http://localhost:3000/api/public/health
```

A healthy server answers `{"ok":true,"status":"ok","database":"ok",...}`. The
container's own health check calls this same address, so Docker reports the
container unhealthy whenever the database stops answering.

## 3. Start it

```bash
docker compose up -d --build
docker compose logs -f app       # watch it boot
```

The site is now on `http://your-server-ip:3000`.

## 4. Put it on your domain with HTTPS

Install Nginx and Certbot, then use this site file
(`/etc/nginx/sites-available/scous`):

```nginx
server {
  listen 80;
  server_name scousgiftcardexchange.com www.scousgiftcardexchange.com;

  client_max_body_size 25m;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

```bash
ln -s /etc/nginx/sites-available/scous /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
certbot --nginx -d scousgiftcardexchange.com -d www.scousgiftcardexchange.com
```

## 5. Day to day

| Task | Command |
| --- | --- |
| Update to the latest code | `git pull && docker compose up -d --build` |
| Restart | `docker compose restart app` |
| Stop | `docker compose down` |
| Logs | `docker compose logs -f app` |
| Health | `docker compose ps` (shows `healthy`) |
| Health detail | `curl -s localhost:3000/api/public/health` |

## Notes

- Nothing secret is stored inside the image; every credential is read from
  `.env` when the container starts.
- Keep `.env` out of Git (it is already ignored).
- Outbound port 465 must be open on the VPS, otherwise sign-in codes and alert
  emails cannot be sent. Some providers block it by default — ask support to
  open it.
