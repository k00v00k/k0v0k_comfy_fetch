WEB_DIRECTORY = "./js"


async def comfy_entrypoint():
    from .plugin.k0v0k_comfy_fetch.bootstrap import create_extension

    return create_extension()


__all__ = ["WEB_DIRECTORY", "comfy_entrypoint"]
