"""Entry point: `python3 -m navpro_rmf_adapter` or `navpro-rmf-adapter`.

All configuration comes from environment variables (see config.py and
README.md); there are no CLI flags so the launch-file and compose invocations
stay identical.
"""

from __future__ import annotations

import logging
import os
import sys

from navpro_rmf_adapter.adapter import run_adapter
from navpro_rmf_adapter.config import AdapterConfig


def main() -> int:
    logging.basicConfig(
        level=os.environ.get("NAVPRO_LOG_LEVEL", "INFO").upper(),
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )
    cfg = AdapterConfig.from_env()
    try:
        cfg.validate()
    except (FileNotFoundError, ValueError) as exc:
        logging.getLogger(__name__).error("%s", exc)
        return 1
    run_adapter(cfg)
    return 0


if __name__ == "__main__":
    sys.exit(main())
