# Per-robot logging (robot -> Loki -> Grafana)

## Pipeline

1. Each robot Pi runs `navpro-logship.service`
   (`NavProMini_ws/src/navpromini_fleet/scripts/logship.sh`): a lightweight
   shipper that tails `journalctl -u navpro-robot -u navpro-fleet -o json`
   and POSTs batches to the server's Loki push endpoint:

   ```
   https://<LAN_IP>/loki/api/v1/push
   X-Provisioning-Token: <token>
   labels: {job="robot", robot="<name>", unit="<systemd unit>"}
   ```

   nginx forwards to Loki inside the Docker network (Loki is never exposed
   directly); requests without the token header are rejected.

2. Server containers log to the Docker json-file driver; `docker compose logs`
   covers server-side debugging. (A promtail/alloy sidecar for container logs
   is a later addition if needed.)

## Viewing

- Grafana -> Explore -> Loki datasource -> `{job="robot", robot="bot-1"}`.
- Retention: 30 days (observability/loki/loki.yml `retention_period`).

## Per-robot log download (support engineers)

From any machine with access:

```bash
curl -G -k "https://<LAN_IP>/grafana/api/datasources/proxy/uid/loki/loki/api/v1/query_range" \
  --data-urlencode 'query={job="robot",robot="bot-1"}' \
  --data-urlencode "start=$(date -d '-24 hours' +%s)000000000" \
  --data-urlencode "end=$(date +%s)000000000" \
  -H "Authorization: Bearer <grafana-service-account-token>" > bot-1-logs.json
```

The GUI robot detail page links to the pre-filtered Grafana Explore view for
one-click access.
