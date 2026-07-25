# Fleet server scripts (real robots)

| Path | Purpose |
|------|---------|
| `watch_reload_rmf.sh` | Compose service: bounce `rmf-core` when `site/.reload-requested` appears |
| `reload_rmf_core.sh` | Manual RMF core recreate (+ api-server) |
| `ops/backup.sh` | Site / DB backup helpers |
| `ops/gen_certs.sh` | TLS / JWT key helpers |

## Day-1 bringup

```bash
docker compose up -d
```

Robots use ROS domain **77** (see `.env` `ROS_DOMAIN_ID`), zenoh on `LAN_IP:7447`, and the in-compose RMF stack (`rmf-core` + `rmf-api-server`).

Do not run host-network RMF / Gazebo bridge containers against this stack — they share the `rmf_api` database and wipe Overview robots.
