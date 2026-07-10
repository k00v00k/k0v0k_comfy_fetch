from __future__ import annotations

from .auth import K0V0KComfyFetchAuthManager
from .asset_api import ComfyAssetApiClient
from .config import load_config
from .job_manager import MissingInputResolverJobManager
from .logger import get_logger


class K0V0KComfyFetchExtension:
    def __init__(self):
        self.logger = get_logger()
        self.config = load_config()
        self.auth = K0V0KComfyFetchAuthManager()
        self.client = ComfyAssetApiClient(
            base_url=self.config.asset_api_base_url,
            api_token=self.config.asset_api_token,
            token_required=self.config.asset_api_token_required,
        )
        self.job_manager = MissingInputResolverJobManager(
            client=self.client,
            config=self.config,
            logger=self.logger,
            emit_event=self.emit_event,
        )

    def emit_event(self, event_name: str, payload: dict) -> None:
        try:
            from server import PromptServer

            PromptServer.instance.send_sync(event_name, payload)
        except Exception as exc:
            self.logger.warning("Failed to send websocket event %s: %s", event_name, exc)

    def startup_status(self) -> dict:
        disk = self.job_manager._safe_disk_report()
        return {
            "asset_api_base_url": self.config.asset_api_base_url,
            "asset_api_token_required": self.config.asset_api_token_required,
            "max_retries": self.config.max_retries,
            "download_staging_path": self.config.download_staging_path,
            "download_staging": disk,
        }
