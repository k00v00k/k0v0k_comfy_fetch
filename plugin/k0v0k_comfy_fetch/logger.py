import logging


def get_logger() -> logging.Logger:
    logger = logging.getLogger("k0v0k_comfy_fetch")
    if logger.handlers:
        return logger
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("[K0V0K Comfy Fetch] %(levelname)s %(message)s"))
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)
    logger.propagate = False
    return logger
