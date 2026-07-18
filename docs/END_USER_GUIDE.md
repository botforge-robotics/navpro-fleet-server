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
2. Connect to a network named **`NavPro-Setup-XXXX`**  
   (`XXXX` is unique to that robot).
3. Use the password shown on the robot screen (or on the setup page).

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
   Cover the full area; don’t skip corners.  
   *(Use a hand-held remote, gamepad, or gently push — whatever your site uses.)*  
4. **Save map** — freezes the map on the robot.  
5. **Upload to level** — choose the floor (e.g. `L1`).  
6. **Upload map.pgm + map.yaml** — select both files from your computer and upload.

**Getting the map files onto your laptop**

After **Save map**, the robot stores two files (names may be `slam_session.pgm`
and `slam_session.yaml`). Copy them to the PC where you use the browser — USB
stick, shared folder, or ask your installer for the usual method at your site.

7. **Stop** — ends mapping mode when you are done.

You should see a success message. Next: draw the **navigation graph** (Part 3).

---

## Part 3 — Draw the building (lanes, chargers, doors)

The occupancy map is only a picture. The fleet also needs **waypoints and lanes**
so robots know where they can drive and where chargers are.

### Open the **Building** tab

You will see the **traffic editor** — a drawing tool inside the browser.

**First time:**

1. In the editor menu: **File → New** or **Open** → use `building.yaml` under the site folder if one exists.  
2. **Add a level** that matches your floor name (e.g. `L1`).  
3. Set the level’s **drawing** to your uploaded occupancy image if prompted.

**Mark important points:**

| Thing | How | Why |
|-------|-----|-----|
| **Charger / dock** | Place a vertex, name it (e.g. `charger_1`), mark as **charger** | Robot must know where to charge |
| **Lanes** | Draw lanes along paths robots should follow | Traffic rules |
| **Doors / lifts** | Add if your site uses them | Optional automation |

**Save often:** **File → Save** in the editor.

**Apply to fleet:** Back at the top of the Building tab, click **Apply to fleet**.
Wait for the green success message — this pushes the layout to live robots.

> **Already have a CAD / traffic-editor file?**  
> Paste a `building.yaml` export into **Import building.yaml** at the bottom of
> the Building tab, then click **Apply to fleet**.

---

## Part 4 — Commission the robot (make it “live”)

Commissioning tells the fleet *which floor* this robot is on and *which charger is home*.

1. Go to **Devices** → **Robot commissioning**.  
2. Under **Pending**, click **Commission** on your robot.  
3. Fill in:

| Field | Guidance |
|-------|----------|
| **Name** | Keep or adjust the robot name |
| **Fleet** | Select your fleet |
| **Level** | The floor you mapped (e.g. `L1`) |
| **Charger waypoint** | Pick the charger name you drew in the Building editor |
| **Home waypoint** | Usually the same as the charger |

4. Click **Activate**.

Within a few seconds the robot should appear on the **Overview** map with a
**green “Ready”** style status (robot LED often turns **solid green**).

---

## Part 5 — Add more robots

Every new robot uses the **same Wi‑Fi setup flow** (Part 1). No duplicate work on
the server side except commissioning.

| Step | Action |
|------|--------|
| 1 | Power on the next robot |
| 2 | Join `NavPro-Setup-XXXX`, open `http://10.42.0.1/` |
| 3 | Use a **new robot name** (`bot-2`, `bot-3`, …) — same token + server IP |
| 4 | In **Devices → Commissioning**, **Commission** and **Activate** (pick fleet, floor, charger) |

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
Power on → Wi‑Fi NavPro-Setup-XXXX → http://10.42.0.1/
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
