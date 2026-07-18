import CloseIcon from '@mui/icons-material/Close';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import type { MouseEvent, ReactElement } from 'react';
import { useState } from 'react';
import './help-guide.css';

function scrollToSection(e: MouseEvent<HTMLAnchorElement>, id: string): void {
  e.preventDefault();
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/**
 * App-bar Help Guide control (before profile icon). Opens an in-app HTML/CSS
 * operator guide — no markdown, no external docs.
 */
export function HelpGuideButton(): ReactElement {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Tooltip title="Help guide">
        <IconButton
          id="navpro-help-btn"
          aria-label="Open help guide"
          color="inherit"
          onClick={() => setOpen(true)}
        >
          <HelpOutlineIcon />
        </IconButton>
      </Tooltip>

      <Drawer
        anchor="right"
        open={open}
        onClose={() => setOpen(false)}
        className="navpro-help-drawer"
        ModalProps={{ keepMounted: true }}
      >
        <article className="navpro-help">
          <header className="navpro-help__header">
            <h1 className="navpro-help__title">NavPro Fleet — Help guide</h1>
            <IconButton aria-label="Close help guide" onClick={() => setOpen(false)} size="small">
              <CloseIcon />
            </IconButton>
          </header>

          <div className="navpro-help__body">
            <p className="navpro-help__lead">
              For site operators deploying robots at a building. Robots arrive ready — you use this
              web app and each robot&apos;s Wi‑Fi setup screen. No programming required.
            </p>

            <ul className="navpro-help__toc">
              <li>
                <a href="#help-before" onClick={(e) => scrollToSection(e, 'help-before')}>
                  Before you start
                </a>
              </li>
              <li>
                <a href="#help-connect" onClick={(e) => scrollToSection(e, 'help-connect')}>
                  Connect a robot
                </a>
              </li>
              <li>
                <a href="#help-mapping" onClick={(e) => scrollToSection(e, 'help-mapping')}>
                  Mapping
                </a>
              </li>
              <li>
                <a href="#help-building" onClick={(e) => scrollToSection(e, 'help-building')}>
                  Building editor
                </a>
              </li>
              <li>
                <a href="#help-commission" onClick={(e) => scrollToSection(e, 'help-commission')}>
                  Commission
                </a>
              </li>
              <li>
                <a href="#help-more" onClick={(e) => scrollToSection(e, 'help-more')}>
                  More robots
                </a>
              </li>
              <li>
                <a href="#help-fixes" onClick={(e) => scrollToSection(e, 'help-fixes')}>
                  Map fixes
                </a>
              </li>
              <li>
                <a href="#help-daily" onClick={(e) => scrollToSection(e, 'help-daily')}>
                  Daily use
                </a>
              </li>
              <li>
                <a
                  href="#help-troubleshoot"
                  onClick={(e) => scrollToSection(e, 'help-troubleshoot')}
                >
                  Troubleshooting
                </a>
              </li>
            </ul>

            <section id="help-before">
              <h2>What you need before starting</h2>
              <p>Ask whoever installed the fleet server for these three items:</p>
              <table>
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Example</th>
                    <th>Why</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>
                      <strong>Fleet web address</strong>
                    </td>
                    <td>
                      <code>https://192.168.1.10/</code>
                    </td>
                    <td>Open this control panel</td>
                  </tr>
                  <tr>
                    <td>
                      <strong>Login</strong>
                    </td>
                    <td>
                      <code>admin</code> / password
                    </td>
                    <td>Sign in here</td>
                  </tr>
                  <tr>
                    <td>
                      <strong>Provisioning token</strong>
                    </td>
                    <td>
                      from server <code>.env</code>
                    </td>
                    <td>
                      Site password for robots — same on every robot setup form (
                      <code>PROVISIONING_TOKEN</code>)
                    </td>
                  </tr>
                </tbody>
              </table>
              <ul className="navpro-help__checklist">
                <li>Site Wi‑Fi covers the whole drive area</li>
                <li>Fleet server PC is on and reachable</li>
                <li>Chargers are in final positions</li>
                <li>Robots are charged</li>
              </ul>
              <div className="navpro-help__callout">
                <strong>Tip</strong>
                Robots are not added by typing an IP in the GUI. Each robot joins after you finish
                its Wi‑Fi setup page.
              </div>
            </section>

            <section id="help-picture">
              <h2>Big picture</h2>
              <div className="navpro-help__diagram">{`Your PC / tablet  ──Wi‑Fi──►  Fleet server (this web app)
                                          │
                                     same Wi‑Fi
                                          ▼
                                   Robot 1, 2, …`}</div>
              <ol>
                <li>Connect each robot to Wi‑Fi (hotspot setup) → robot appears here</li>
                <li>
                  <strong>Map</strong> the floor (if you don&apos;t have a floor plan)
                </li>
                <li>
                  <strong>Draw</strong> lanes, chargers, doors in Building
                </li>
                <li>
                  <strong>Commission</strong> each robot (fleet, floor, charger)
                </li>
                <li>Run a test task on Map / Tasks</li>
              </ol>
            </section>

            <section id="help-connect">
              <h2>Part 1 — Connect your first robot</h2>
              <ol className="navpro-help__steps">
                <li>
                  <h3>Power on</h3>
                  <p>Wait about one minute. The robot screen may show Wi‑Fi name, password, and a
                    URL. LED strip blinks amber while waiting for setup.</p>
                </li>
                <li>
                  <h3>Join the robot&apos;s setup Wi‑Fi</h3>
                  <p>
                    On your phone or laptop, connect to <code>NavPro-Setup-XXXX</code> (unique per
                    robot). Use the password on the robot screen.
                  </p>
                </li>
                <li>
                  <h3>Open the setup page</h3>
                  <p>
                    Browser → <code>http://10.42.0.1/</code>
                  </p>
                  <table>
                    <thead>
                      <tr>
                        <th>Field</th>
                        <th>What to enter</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td>Wi‑Fi network / password</td>
                        <td>Your site Wi‑Fi (robots must reach the fleet server)</td>
                      </tr>
                      <tr>
                        <td>Robot name</td>
                        <td>
                          Unique, e.g. <code>bot-1</code>
                        </td>
                      </tr>
                      <tr>
                        <td>Server address</td>
                        <td>
                          IP only, e.g. <code>192.168.1.10</code> (no https://)
                        </td>
                      </tr>
                      <tr>
                        <td>Provisioning token</td>
                        <td>
                          Site secret from the fleet server <code>.env</code> (
                          <code>PROVISIONING_TOKEN</code>) — same for every robot
                        </td>
                      </tr>
                    </tbody>
                  </table>
                  <div className="navpro-help__callout">
                    <strong>No fleet name or floor here</strong>
                    Fleet and floor are set later in <strong>Devices → Commission</strong>.
                    Robots can move between floors using the Building graph (RMF lifts /
                    levels) — they are not locked to one floor at Wi‑Fi setup.
                  </div>
                  <p>
                    Tap <strong>Save</strong>. The robot joins site Wi‑Fi and registers with the
                    fleet. If Wi‑Fi fails, setup mode returns — check the password and retry.
                  </p>
                </li>
                <li>
                  <h3>Confirm in this web app</h3>
                  <p>
                    Go to <strong>Devices</strong> → <strong>Robot commissioning</strong>. Your
                    robot should appear under <strong>Pending</strong> within a minute or two.
                  </p>
                </li>
              </ol>
              <div className="navpro-help__callout">
                <strong>Normal after connect</strong>
                Robot screen may show “Joining fleet…” (cyan LED), then “Need map” (yellow) until
                the site map is ready.
              </div>
            </section>

            <section id="help-mapping">
              <h2>Part 2 — Create a map</h2>
              <p>Skip if a map and building layout are already uploaded.</p>
              <p>
                One robot drives around and learns walls and open space — that becomes the
                occupancy map used for navigation.
              </p>
              <h3>In the Mapping tab</h3>
              <ol>
                <li>
                  Choose the <strong>Mapping robot</strong>
                </li>
                <li>
                  Click <strong>Start SLAM</strong> (wait ~30 seconds)
                </li>
                <li>Drive slowly through every aisle and room you will use later</li>
                <li>
                  Click <strong>Save map</strong>
                </li>
                <li>
                  Choose the level (e.g. <code>L1</code>)
                </li>
                <li>
                  Upload both <code>map.pgm</code> and <code>map.yaml</code>
                </li>
                <li>
                  Click <strong>Stop</strong> when finished
                </li>
              </ol>
              <div className="navpro-help__callout">
                <strong>Getting the map files</strong>
                After Save, the robot stores files such as <code>slam_session.pgm</code> and{' '}
                <code>slam_session.yaml</code>. Copy them to this PC (USB, shared folder, or your
                site&apos;s usual method), then upload here.
              </div>
            </section>

            <section id="help-building">
              <h2>Part 3 — Draw the building</h2>
              <p>
                The map is only a picture. You also need waypoints and lanes so robots know where to
                drive and where chargers are.
              </p>
              <p>
                Open the <strong>Building</strong> tab (traffic editor in the browser).
              </p>
              <ul>
                <li>
                  <strong>Charger / dock</strong> — place a vertex, name it (e.g.{' '}
                  <code>charger_1</code>), mark as charger
                </li>
                <li>
                  <strong>Lanes</strong> — draw paths robots should follow
                </li>
                <li>
                  <strong>Doors / lifts</strong> — optional if your site uses them
                </li>
              </ul>
              <p>
                <strong>File → Save</strong> often. Then click <strong>Apply to fleet</strong> and
                wait for the success message.
              </p>
              <div className="navpro-help__callout">
                <strong>Already have a building.yaml?</strong>
                Paste it into Import at the bottom of the Building tab, then Apply to fleet.
              </div>
            </section>

            <section id="help-commission">
              <h2>Part 4 — Commission the robot</h2>
              <ol>
                <li>
                  <strong>Devices</strong> → <strong>Robot commissioning</strong>
                </li>
                <li>
                  Under Pending, click <strong>Commission</strong>
                </li>
                <li>
                  Set Name, Fleet, Level, Charger waypoint, and Home (usually same as charger)
                </li>
                <li>
                  Click <strong>Activate</strong>
                </li>
              </ol>
              <p>
                Within a few seconds the robot should appear on Overview / Map. LED often turns
                solid green when ready.
              </p>
            </section>

            <section id="help-more">
              <h2>Part 5 — Add more robots</h2>
              <table>
                <thead>
                  <tr>
                    <th>Step</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>1</td>
                    <td>Power on the next robot</td>
                  </tr>
                  <tr>
                    <td>2</td>
                    <td>
                      Join <code>NavPro-Setup-XXXX</code> → <code>http://10.42.0.1/</code>
                    </td>
                  </tr>
                  <tr>
                    <td>3</td>
                    <td>
                      New robot name (<code>bot-2</code>, …) — same token + server IP
                    </td>
                  </tr>
                  <tr>
                    <td>4</td>
                    <td>Devices → Commission → Activate (pick fleet, floor, charger)</td>
                  </tr>
                </tbody>
              </table>
              <p>
                You only map once per floor. Extra robots reuse the same map and building graph —
                each gets its own name and charger.
              </p>
            </section>

            <section id="help-fixes">
              <h2>Part 6 — Map editing and fixes</h2>
              <h3>Floor layout changed</h3>
              <p>
                Mapping → SLAM again → upload → Building → adjust lanes → Apply to fleet. Ask your
                installer if positions look wrong after a big change.
              </p>
              <h3>Robot icon misaligned on the map</h3>
              <p>
                Robots tab → robot row → map transform (x, y, yaw, scale). Leave defaults if the
                graph was drawn on the same SLAM image.
              </p>
              <h3>Edit or retire</h3>
              <p>
                Robots tab → edit name/fleet/charger, or retire when a unit is removed from service.
              </p>
            </section>

            <section id="help-daily">
              <h2>Part 7 — Daily use</h2>
              <ul className="navpro-help__checklist">
                <li>All robots Active under Devices → commissioning</li>
                <li>Robots visible on Overview or Map</li>
                <li>Battery and mode updating (not stuck offline)</li>
                <li>Chargers marked on the building graph</li>
              </ul>
              <table>
                <thead>
                  <tr>
                    <th>Tab</th>
                    <th>Use for</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Overview</td>
                    <td>All robots, doors, lifts</td>
                  </tr>
                  <tr>
                    <td>Map</td>
                    <td>Full-screen fleet map</td>
                  </tr>
                  <tr>
                    <td>Tasks</td>
                    <td>Patrol / delivery style tasks</td>
                  </tr>
                  <tr>
                    <td>Missions</td>
                    <td>Site-specific workflows (if enabled)</td>
                  </tr>
                </tbody>
              </table>
              <div className="navpro-help__callout navpro-help__callout--warn">
                <strong>Safety</strong>
                The physical E‑stop on the robot always works, even if Wi‑Fi or the server is down.
                Local obstacle avoidance does not depend on this web app.
              </div>
            </section>

            <section id="help-troubleshoot">
              <h2>Troubleshooting</h2>
              <table>
                <thead>
                  <tr>
                    <th>Problem</th>
                    <th>What to try</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Can&apos;t open web page</td>
                    <td>Same Wi‑Fi? Correct IP? Accept local HTTPS certificate warning.</td>
                  </tr>
                  <tr>
                    <td>Robot not Pending</td>
                    <td>Wait 2–3 min; check server IP + token; robot on site Wi‑Fi.</td>
                  </tr>
                  <tr>
                    <td>No setup hotspot</td>
                    <td>Power-cycle robot; contact support if still missing.</td>
                  </tr>
                  <tr>
                    <td>Start SLAM does nothing</td>
                    <td>Robot online? Wait 30s; check recent heartbeat in Devices.</td>
                  </tr>
                  <tr>
                    <td>No charger in dropdown</td>
                    <td>Draw chargers in Building → Apply to fleet first.</td>
                  </tr>
                  <tr>
                    <td>“Need map” on robot</td>
                    <td>Normal until map uploaded and robot commissioned.</td>
                  </tr>
                  <tr>
                    <td>Two robots same name</td>
                    <td>Each robot needs a unique name on the setup form.</td>
                  </tr>
                </tbody>
              </table>

              <h3>Quick reference</h3>
              <div className="navpro-help__ref">{`FIRST ROBOT
Power on → NavPro-Setup-XXXX → http://10.42.0.1/
→ site Wi‑Fi + robot name + token + server IP
→ Mapping (SLAM → save → upload)
→ Building (chargers / lanes / floors → Apply to fleet)
→ Devices → Commission (fleet, floor, charger) → Activate
→ Overview / Tasks

EACH EXTRA ROBOT
Power on → setup form (new name!) → Commission → Activate

COMMISSION (not hotspot)
Fleet + floor + charger waypoint = set in Devices
Robots can change floors via RMF building graph / lifts`}</div>
            </section>
          </div>
        </article>
      </Drawer>
    </>
  );
}
