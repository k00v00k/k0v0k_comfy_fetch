from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path


def _package_root() -> Path:
    return Path(__file__).resolve().parents[2]


def _load_config_file() -> dict[str, object]:
    env_path = os.environ.get("K0V0K_COMFY_FETCH_CONFIG", "").strip()
    candidates = []
    if env_path:
        candidates.append(Path(env_path).expanduser())
    candidates.append(_package_root() / "config" / "k0v0k-comfy-fetch.local.json")
    candidates.append(_package_root() / "config" / "k0v0k-comfy-fetch.example.json")
    for candidate in candidates:
        if candidate.exists():
            with candidate.open("r", encoding="utf-8") as handle:
                loaded = json.load(handle)
            if isinstance(loaded, dict):
                return loaded
    return {}


def _parse_bool(value: object, default: bool = False) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class K0V0KComfyFetchConfig:
    asset_api_base_url: str
    asset_api_token: str
    asset_api_token_required: bool
    job_poll_seconds: float
    max_retries: int
    download_staging_path: str


def load_config() -> K0V0KComfyFetchConfig:
    data = _load_config_file()
    asset_api_port = str(os.environ.get("COMFY_ASSET_API_PORT", "8189")).strip() or "8189"
    asset_api_base_url = (
        str(os.environ.get("K0V0K_COMFY_FETCH_ASSET_API_BASE_URL", "")).strip()
        or str(data.get("asset_api_base_url", "")).strip()
        or f"http://127.0.0.1:{asset_api_port}"
    )
    job_poll_seconds = float(
        os.environ.get("K0V0K_COMFY_FETCH_JOB_POLL_SECONDS")
        or data.get("job_poll_seconds", 1.5)
    )
    max_retries = int(
        os.environ.get("K0V0K_COMFY_FETCH_MAX_RETRIES")
        or data.get("max_retries", 5)
    )
    download_staging_path = (
        str(os.environ.get("K0V0K_COMFY_FETCH_DOWNLOAD_STAGING_PATH", "")).strip()
        or str(data.get("download_staging_path", "")).strip()
        or "/srv/comfy/download-staging"
    )
    asset_api_token = str(os.environ.get("COMFY_ASSET_API_TOKEN", "")).strip()
    asset_api_token_required = _parse_bool(
        os.environ.get("COMFY_ASSET_API_TOKEN_REQUIRED", None),
        default=bool(asset_api_token),
    )
    return K0V0KComfyFetchConfig(
        asset_api_base_url=asset_api_base_url.rstrip("/"),
        asset_api_token=asset_api_token,
        asset_api_token_required=asset_api_token_required,
        job_poll_seconds=max(job_poll_seconds, 0.5),
        max_retries=max(max_retries, 0),
        download_staging_path=download_staging_path,
    )
