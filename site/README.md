# site/ - generated per-client configuration (data, not code)

This directory is mounted into the containers. Everything in it is **generated
by the Platform API from the Registry** (PostgreSQL) - never hand-edited.

```
site/
  site.building.yaml     # RMF building map (*.building.yaml required by building_map_server)
  building.yaml          # legacy/compat copy (traffic-editor may save this name)
  nav_graphs/            # generated per-fleet nav graphs (0.yaml, ...)
  fleet_config/          # free_fleet_adapter config per fleet (<fleet>.yaml)
  maps/                  # occupancy maps + visual floorplans per level
  ota/                   # OTA artifacts by channel (pi/, esp32/, config/)
  registry-snapshot.json # last generation input snapshot (debugging/restore)
```

> **Important:** Open-RMF `building_map_server` rejects plain `building.yaml`
> (`unknown filename suffix`). The platform always writes `site.building.yaml`
> as well. Without that file, Devices → Building hardware shows empty and
> `/rmf/building_map` returns 404.

Workflow:

1. Author the building in `rmf_traffic_editor` (Phase 1) and import it via
   `POST /api/v1/site/import-building`, or edit records directly in the GUI.
2. Any registry change that affects RMF emits `registry.changed`; the config
   generator validates and atomically rewrites the artifacts here.
3. `rmf-core` reads this directory read-only. Dynamic robot ADD does not need
   a reload; fleet-level changes trigger the platform's graceful reload
   (see ../docs/SPIKES.md, spike 1).

To restore a site: drop a previous `site/` folder + Postgres backup, then
`docker compose up -d`.
