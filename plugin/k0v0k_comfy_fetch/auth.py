from __future__ import annotations

import hmac
import secrets
from dataclasses import dataclass
from urllib.parse import urlparse

from aiohttp import web


@dataclass(frozen=True)
class K0V0KComfyFetchAuthConfig:
    cookie_name: str = "k0v0k_comfy_fetch_session"
    cookie_path: str = "/k0v0k/comfy-fetch"
    cookie_max_age_seconds: int = 8 * 60 * 60


class K0V0KComfyFetchAuthManager:
    def __init__(self, config: K0V0KComfyFetchAuthConfig | None = None):
        self.config = config or K0V0KComfyFetchAuthConfig()
        self._secret = secrets.token_urlsafe(32)

    def is_request_authenticated(self, request: web.Request) -> bool:
        cookie_value = request.cookies.get(self.config.cookie_name, "")
        if not cookie_value:
            return False
        return hmac.compare_digest(cookie_value, self._secret)

    def issue_cookie(self, response: web.StreamResponse, request: web.Request) -> None:
        response.set_cookie(
            self.config.cookie_name,
            self._secret,
            max_age=self.config.cookie_max_age_seconds,
            httponly=True,
            samesite="Strict",
            secure=bool(request.secure),
            path=self.config.cookie_path,
        )

    def bootstrap_request_allowed(self, request: web.Request) -> bool:
        sec_fetch_site = (request.headers.get("Sec-Fetch-Site") or "").strip().lower()
        if sec_fetch_site == "cross-site":
            return False
        if sec_fetch_site and sec_fetch_site not in {"same-origin", "same-site", "none"}:
            return False

        request_origin = self._request_origin(request)
        if request_origin is None:
            return False

        for header_name in ("Origin", "Referer"):
            header_value = (request.headers.get(header_name) or "").strip()
            if not header_value:
                continue
            parsed = urlparse(header_value)
            candidate_origin = self._origin_from_parts(parsed.scheme, parsed.netloc)
            if candidate_origin != request_origin:
                return False
        return True

    def _request_origin(self, request: web.Request) -> str | None:
        host = (request.headers.get("Host") or request.host or "").strip()
        if not host:
            return None
        scheme = "https" if request.secure else "http"
        return self._origin_from_parts(scheme, host)

    @staticmethod
    def _origin_from_parts(scheme: str, netloc: str) -> str:
        return f"{scheme.lower()}://{netloc.lower()}"
