"""Platform API registry client.

Talks to the NavPro Platform API only (never to RMF): polls the robot
registry and optionally posts robot state snapshots back.

Endpoints used:
  GET  /api/v1/robots?fleet=<name>&status=active
  POST /api/v1/robots/<id>/state          (optional snapshots)

Auth: `Authorization: Bearer <service token>` when a service token is
configured, otherwise `X-Provisioning-Token: <token>`.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

import httpx

_LOGGER = logging.getLogger(__name__)


@dataclass(frozen=True)
class RegistryRobot:
    """Subset of the platform robot registry record the adapter needs."""

    id: str
    name: str
    fleet: str
    status: str

    @classmethod
    def from_json(cls, data: dict[str, Any]) -> "RegistryRobot":
        return cls(
            id=str(data["id"]),
            name=str(data["name"]),
            fleet=str(data.get("fleet", "")),
            status=str(data.get("status", "")),
        )


class RegistryClient:
    def __init__(
        self,
        base_url: str,
        service_token: str | None = None,
        provisioning_token: str | None = None,
        timeout_sec: float = 4.0,
    ):
        headers = {"Accept": "application/json"}
        if service_token:
            headers["Authorization"] = f"Bearer {service_token}"
        elif provisioning_token:
            headers["X-Provisioning-Token"] = provisioning_token
        self._client = httpx.Client(
            base_url=base_url,
            headers=headers,
            timeout=timeout_sec,
        )

    def close(self) -> None:
        self._client.close()

    def list_active_robots(self, fleet: str) -> list[RegistryRobot]:
        """Return active robots registered for `fleet`.

        Raises httpx.HTTPError on transport/status failures; callers are
        expected to catch and retry on the next poll tick.
        """
        response = self._client.get(
            "/api/v1/robots",
            params={"fleet": fleet, "status": "active"},
        )
        response.raise_for_status()
        payload = response.json()
        # Accept either a bare list or an enveloped {"robots": [...]}.
        items = payload["robots"] if isinstance(payload, dict) else payload
        robots = []
        for item in items:
            try:
                robots.append(RegistryRobot.from_json(item))
            except (KeyError, TypeError) as exc:
                _LOGGER.warning("Skipping malformed registry record %r: %s",
                                item, exc)
        return robots

    def post_robot_state(self, robot_id: str, state: dict[str, Any]) -> None:
        """Best-effort robot state snapshot; failures are logged, not raised."""
        try:
            response = self._client.post(
                f"/api/v1/robots/{robot_id}/state", json=state
            )
            response.raise_for_status()
        except httpx.HTTPError as exc:
            _LOGGER.debug("State post for robot %s failed: %s", robot_id, exc)
