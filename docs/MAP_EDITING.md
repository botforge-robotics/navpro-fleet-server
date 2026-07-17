# Phased Map Editing

Three assets per level, kept distinct and linked in the Registry:

- **Occupancy map** (Nav2/AMCL) - robot localization/planning.
- **RMF navigation graph** - waypoints/lanes/traffic for coordination.
- **Visual floorplan** - operator display (often the occupancy image).

## Default: official rmf_traffic_editor (in GUI)

The **Building** tab embeds the full Qt
[rmf_traffic_editor](https://github.com/open-rmf/rmf_traffic_editor) via noVNC
(`traffic-editor` Docker service).

1. Map the site (**Mapping** tab) or drop a floorplan image into `site/`.
2. Open **Building** → use traffic-editor (Add level, place vertices/lanes,
   doors, lifts, chargers).
3. **File → Save** to `/site/building.yaml` (or `*.building.yaml`).
4. Click **Apply to fleet** → Platform regenerates nav graphs + fleet config
   and writes `site/.reload-requested`.

Direct URL: `http://<LAN_IP>/editor/`

## Fallback: import YAML

Paste a laptop-exported `building.yaml` into **Building → Import**, or:

```http
POST /api/v1/site/import-building
{ "buildingYaml": "..." }
```

## Occupancy upload API

```http
POST /api/v1/levels/:id/occupancy
{ "pgmBase64": "...", "yamlText": "..." }
```

On the robot:

```bash
ros2 run navpromini_fleet upload_map --level-id <UUID> \
  --pgm /tmp/navpro_map.pgm --yaml /tmp/navpro_map.yaml
```

## Map alignment (per robot map, per level)

Each robot SLAM map must be aligned to the building frame. The GUI alignment
tool (robot detail → Map transform) sets `{x, y, yaw, scale}`; stored in
`robots.map_transform` and emitted into the fleet config `transforms` section
by the config generator. When the building graph was drawn on the same
occupancy map the robots use, the transform is usually identity.
