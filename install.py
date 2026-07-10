from __future__ import annotations

import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent
REQUIREMENTS = ROOT / "requirements.txt"


def main() -> int:
    if not REQUIREMENTS.exists():
        print("[K0V0K Comfy Fetch] requirements.txt not found, skipping dependency install.")
        return 0
    print("[K0V0K Comfy Fetch] Installing Python requirements.")
    subprocess.check_call(
        [
            sys.executable,
            "-m",
            "pip",
            "install",
            "-r",
            str(REQUIREMENTS),
        ]
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
