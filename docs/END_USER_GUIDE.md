# NavPro Fleet — Site operator guide

This guide is for **you** — the person deploying robots at a building or warehouse.
It assumes robots arrive **already prepared** (power on and they work). You use the
**fleet web app** in your browser and each robot’s **Wi‑Fi setup screen** on first
join. No programming required.

---

## What you need before starting

Ask whoever installed the fleet server for these three items:

| Item | Example | Why you need it |
|------|---------|-----------------|
| **Fleet web address** | `https://192.168.1.10/` | Open the control panel |
| **Login username & password** | `admin` / *(your password)* | Sign in to the GUI |
| **Provisioning token** | from server `.env` `PROVISIONING_TOKEN` | Site password for robots — same on every robot setup form |

Also check:

- [ ] Site Wi‑Fi covers the whole area where robots will drive
- [ ] The fleet server PC is on and reachable from that Wi‑Fi
- [ ] Chargers are in their final positions (you will mark them on the map later)
- [ ] Robots are charged

**Tip:** Robots do **not** get added by typing an IP address in the GUI. Each robot
joins by itself after you complete its Wi‑Fi setup page.

---

## Big picture (read once)

```text
  ┌─────────────┐     Wi‑Fi      ┌──────────────────┐
  │  Your PC /  │ ──────────────►│  Fleet server    │
  │  tablet     │   web browser  │  (web app)       │
  └─────────────┘                └────────┬─────────┘
                                        │
                           same Wi‑Fi   │
                                        ▼
                               ┌────────────────┐
                               │  Robot 1, 2…   │
                               └────────────────┘
```

**Typical order for a new site:**

1. Connect each robot to Wi‑Fi (hotspot setup) → robot appears in the GUI  
2. **Map** the floor (if you don’t already have a floor plan)  
3. **Draw** lanes, chargers, and doors in the Building editor  
4. **Commission** each robot (assign fleet, floor, charger)  
5. Run a test task on the **Map** / **Tasks** tabs  

Repeat steps 1 and 4 for every additional robot.

---

## Part 1 — Connect your first robot

### Step 1: Power on

Turn the robot on. Wait about one minute.

- The **small screen** on the robot may show Wi‑Fi name, password, and a web address.
- The **LED strip** blinks **amber** while waiting for setup.

### Step 2: Join the robot’s setup Wi‑Fi

On your phone or laptop:

1. Open Wi‑Fi settings.
2. Connect to **`NavPro-Setup-<MAC6>`** (last 6 hex of robot Wi‑Fi MAC, e.g. `NavPro-Setup-DDEEFF`).
3. Enter password **`navprosetup`** (same on every robot; also shown on the OLED).

### Step 3: Open the setup page

Open a browser and go to:

```text
http://10.42.0.1/
```

Fill in the form:

| Field | What to enter |
|-------|----------------|
| **Wi‑Fi network** | Your site Wi‑Fi name (robots must reach the fleet server on this network) |
| **Wi‑Fi password** | Site Wi‑Fi password |
| **Robot name** | A unique name, e.g. `bot-1`, `bot-warehouse-a` |
| **Server address** | The fleet server IP only, e.g. `192.168.1.10` (no `https://`) |
| **Provisioning token** | Site secret from server `.env` (`PROVISIONING_TOKEN`) — same for every robot |

Do **not** set fleet or floor on this form. Assign those later in **Devices → Commission**.
Robots can move between floors via the Building graph (RMF).

Tap **Save**. The robot will:

- Leave the setup hotspot  
- Join your site Wi‑Fi  
- Register itself with the fleet server  

If Wi‑Fi fails, the robot returns to setup mode — check the password and try again.

### Step 4: Confirm in the web app

1. On your PC, open the fleet web address and log in.  
2. Go to **Devices** → section **Robot commissioning**.  
3. Your robot should appear under **Pending** within a minute or two.

**Robot screen after success:** may show *“Joining fleet…”* (cyan LED), then
*“Need map”* (yellow) until the site map is ready — that is normal.

---

## Part 2 — Create a map (when the site has no floor plan yet)

Skip this part if your installer already uploaded a map and building layout.

### What mapping does

One robot drives around and “learns” the walls and open space. That becomes the
**occupancy map** — the picture the fleet uses for navigation.

### Steps in the **Mapping** tab

1. **Mapping robot** — choose the robot you will drive around (usually your first one).  
2. **Start SLAM** — the robot switches into mapping mode (may take ~30 seconds).  
3. **Drive the robot** slowly through every aisle and room you want it to use later.  
4. **Save map** — freezes the map on the robot and **uploads it to the selected floor** on the fleet server automatically.  
5. **Stop** — ends mapping mode when you are done.

You should see a success message. Next: draw the **navigation graph** (Part 3) or use **Building → Parking wizard** for quick parking/charger spots.

~~USB / laptop copy of map.pgm is no longer required when the robot is online.~~

---

## Part 3 — Draw the building (lanes, chargers, doors)

The occupancy map is only a picture. The fleet also needs **waypoints and lanes**
so robots know where they can drive and where chargers are.

### Open the **Building** tab

Tabs inside Building:

1. **Mapping** — drive a robot and SLAM the floor (if needed)  
2. **Map editor** — clean / rotate the occupancy image  
3. **Parking** — quick wizard to add parking/charger spots (x, y, yaw in meters)  
4. **Building** — full traffic editor for lanes, doors, lifts  

For day-1 chargers/parking you can use the **Parking** wizard, then open the
full editor only if you need lanes.

You will see the **traffic editor** on the Building sub-tab — a drawing tool inside the browser.

**First time (full editor):**

1. In the editor menu: **File → New** or **Open** → use `building.yaml` under the site folder if one exists.  
2. **Add a level** that matches your floor name (e.g. `L1`).  
3. Set the level’s **drawing** to your uploaded occupancy image if prompted.

**Mark important points:**

| Thing | How | Why |
|-------|-----|-----|
| **Charger / dock** | Parking wizard **or** place a vertex, name it (e.g. `parking1`), mark as **charger** | Robot must know where to charge |
| **Lanes** | Draw lanes along paths robots should follow | Traffic rules |
| **Doors / lifts** | Add if your site uses them | Optional automation |

**Save often:** **File → Save** in the editor.

**Apply to fleet:** On the Building sub-tab click **Apply to fleet**, or use
**Save & apply** in the Parking wizard. Wait for success — layout is pushed live
and RMF reloads automatically.

> **Already have a CAD / traffic-editor file?**  
> Paste a `building.yaml` export into **Import building.yaml** at the bottom of
> the Building tab, then click **Apply to fleet**.

---

## Part 4 — Commission the robot (make it “live”)

Commissioning activates the robot on the fleet. Parking and Start Nav are set
per robot afterward (each robot can have a different home).

1. Go to **Devices** → **Robot commissioning**.  
2. Under **Pending**:
   - If the site already has a map → click **Commission**
   - If there is no map yet → click **Claim** (name only), map first, then come back  
3. On the **Active** row, click **Edit** and set:

| Field | Guidance |
|-------|----------|
| **Fleet** | Select your fleet (usually `navpromini`) |
| **Level** | The floor you mapped (e.g. `L1`) |
| **Home / parking** | Waypoint from Parking wizard or Building editor |
| **Charger** | Usually the same as home for day-1 |

4. Click **Nav ready** (starts Nav2 + seeds pose at parking).  
5. Optional: **Set initial pose** again if localization drifts.

The **Nav** column shows on-robot mode (`HARDWARE` / `MAPPING` / `NAV_READY` /
`NAV_ACTIVE`) and a **task-ready** chip when the robot can take RMF tasks.

Within a few seconds the robot should appear on the **Overview** map.

---

## Part 5 — Add more robots

Every new robot uses the **same Wi‑Fi setup flow** (Part 1). No duplicate work on
the server side except commissioning.

| Step | Action |
|------|--------|
| 1 | Power on the next robot |
| 2 | Join `NavPro-Setup-<MAC6>` (pw `navprosetup`), open `http://10.42.0.1/` |
| 3 | Use a **new robot name** (`bot-2`, `bot-3`, …) — same token + server IP |
| 4 | In **Devices → Commissioning**, **Commission** (or **Claim** if no map), then **Edit** + **Nav ready** |

**Same map for all robots on a floor:** You only map once per floor. Additional
robots use the same occupancy map and building graph; each robot gets its own
name and charger assignment.

**Tip:** Commission robots one at a time so names and chargers don’t get mixed up.

---

## Part 6 — Map editing and fixes later

### Change the floor layout (walls moved, new area)

1. **Mapping** tab — run SLAM again on one robot, save, upload to the same level.  
2. **Building** tab — adjust lanes/chargers on the new image, **Save**, **Apply to fleet**.  
3. Robots may need a short restart — ask your installer if positions look wrong after a big map change.

### Robot position looks wrong on the map

If the robot icon doesn’t line up with reality but driving still works locally:

1. Go to **Robots** tab.  
2. Click the robot row → use the **transform** (map alignment) action.  
3. Adjust **x, y, yaw, scale** for that level, or leave defaults if the map was drawn on the same SLAM image.

### Edit robot name, fleet, or charger

**Robots** tab → edit icon on the row, or open the detail drawer.

### Retire a robot

**Robots** tab → retire action when a unit is removed from service (it won’t show on the live map).

---

## Part 7 — You’re ready — daily use

When setup is complete you should see:

- [ ] All robots **Active** under Devices → commissioning  
- [ ] Robots visible on **Overview** or **Map**  
- [ ] Battery and mode updating (not stuck “offline”)  
- [ ] Chargers marked on the building graph  

**Run work:**

| Tab | Use for |
|-----|---------|
| **Overview** | Watch all robots, doors, lifts on one screen |
| **Map** | Full-screen fleet map |
| **Tasks** | Dispatch patrol / delivery style tasks (Open-RMF tasks) |
| **Missions** | Site-specific mission workflows (if enabled) |

**Safety reminder:** The physical **E‑stop** on the robot always works, even if
Wi‑Fi or the server is down. Robots finish or stop their current local move safely;
they do not depend on the server to avoid obstacles nearby.

---

## Troubleshooting (common issues)

| Problem | What to try |
|---------|-------------|
| Can’t open fleet web page | Same Wi‑Fi as robots? Correct IP? Accept browser security warning if using HTTPS with a local certificate. |
| Robot not in **Pending** | Wait 2–3 min; confirm server IP and token on setup form; robot must be on site Wi‑Fi. |
| Setup hotspot never appears | Power-cycle robot; if still missing, contact support (unit may need service). |
| **Start SLAM** does nothing | Robot must be online in the GUI; wait 30s and try again; check Devices that heartbeat is recent. |
| No charger in commission dropdown | Draw chargers in Building editor → **Apply to fleet** first. |
| Robot “Need map” on screen | Normal until map is uploaded and robot is commissioned on that level. |
| Two robots same name | Each robot needs a **unique name** on the setup form. |

---

## Quick reference card

```text
FIRST ROBOT ON A NEW SITE
─────────────────────────
Power on → Wi‑Fi NavPro-Setup-&lt;MAC6&gt; (pw navprosetup) → http://10.42.0.1/
→ site Wi‑Fi + robot name + token + server IP
→ GUI: Mapping (SLAM → save → upload)
→ GUI: Building (chargers / lanes / floors → Apply to fleet)
→ GUI: Devices → Commission (fleet, floor, charger) → Activate
→ GUI: Overview / Tasks — go

EACH EXTRA ROBOT
────────────────
Power on → setup Wi‑Fi form (new name!) → Devices → Commission → Activate

COMMISSION (not hotspot)
────────────────────────
Fleet + floor + charger waypoint  =  set in Devices → Commission
Robots can change floors via RMF building graph / lifts
```

---

## Where to get help

- **Server / login / token issues** — whoever installed the fleet server (`DEPLOYMENT.md` is for them).  
- **Robot hardware / E‑stop / battery** — your NavPro supplier or maintenance team.  
- **Advanced map editing** — see [MAP_EDITING.md](MAP_EDITING.md) (technical supplement).
