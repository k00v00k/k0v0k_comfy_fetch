from __future__ import annotations

import json

from comfy_api.latest import ComfyExtension, io

from .logger import get_logger
from .routes import register_routes
from .runtime import K0V0KComfyFetchExtension


_EXTENSION = None


def initialize_extension():
    global _EXTENSION
    if _EXTENSION is not None:
        return _EXTENSION
    logger = get_logger()
    _EXTENSION = K0V0KComfyFetchExtension()
    register_routes(_EXTENSION)
    logger.info("Loaded K0V0K Comfy Fetch extension.")
    logger.info("Startup status: %s", json.dumps(_EXTENSION.startup_status(), sort_keys=True))
    return _EXTENSION


class K0V0KComfyFetchComfyExtension(ComfyExtension):
    async def on_load(self) -> None:
        initialize_extension()

    async def get_node_list(self) -> list[type[io.ComfyNode]]:
        return []


def create_extension() -> K0V0KComfyFetchComfyExtension:
    return K0V0KComfyFetchComfyExtension()
