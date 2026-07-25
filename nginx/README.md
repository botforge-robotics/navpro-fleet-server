# Fleet web edge (nginx + baked-in GUI)

Single image `navpro/fleet-web` contains:

- Static GUI from in-repo `web-gui/` (`/usr/share/nginx/html`)
- Reverse proxy for `/api`, `/rmf`, `/editor`, `/grafana`, `/loki`

No separate GUI container or sibling repo is required.

## Build & run

```bash
cd /path/to/navpro-fleet-server
cp .env.example .env   # set LAN_IP, passwords, PROVISIONING_TOKEN
./scripts/ops/gen_certs.sh # if first time

docker compose build nginx
docker compose up -d
```

## Open in browser

```text
http://<LAN_IP>/
```

Example:

```text
http://192.168.0.101/
```

Login: `ADMIN_USERNAME` / `ADMIN_PASSWORD` from `.env`.

| URL | What |
|-----|------|
| `http://<LAN_IP>/` | Fleet GUI |
| `http://<LAN_IP>/devices` | Commission robots + doors/lifts |
| `http://<LAN_IP>/building` | traffic-editor (noVNC) |
| `http://<LAN_IP>/grafana/` | Grafana |

## Edit GUI / rebuild

Source lives in `web-gui/`. After changes:

```bash
docker compose build nginx && docker compose up -d nginx
```

Hard-refresh the browser.
