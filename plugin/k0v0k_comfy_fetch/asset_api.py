from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Any


class AssetApiError(RuntimeError):
    def __init__(self, message: str, *, status: int | None = None, payload: Any = None):
        super().__init__(message)
        self.status = status
        self.payload = payload


class ComfyAssetApiClient:
    def __init__(self, *, base_url: str, api_token: str = "", token_required: bool = True, timeout_seconds: float = 60.0):
        self.base_url = base_url.rstrip("/")
        self.api_token = api_token
        self.token_required = token_required
        self.timeout_seconds = timeout_seconds

    def _headers(self, json_body: bool = False) -> dict[str, str]:
        headers: dict[str, str] = {}
        if json_body:
            headers["Content-Type"] = "application/json"
        if self.token_required and self.api_token:
            headers["X-API-Key"] = self.api_token
        return headers

    def _request(self, method: str, path: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
        body = None
        headers = self._headers(json_body=payload is not None)
        if payload is not None:
            body = json.dumps(payload).encode("utf-8")
        request = urllib.request.Request(
            f"{self.base_url}{path}",
            data=body,
            headers=headers,
            method=method,
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout_seconds) as response:
                raw = response.read().decode("utf-8")
                decoded = json.loads(raw) if raw else {}
                if not isinstance(decoded, dict):
                    raise AssetApiError("asset API returned a non-object response")
                return decoded
        except urllib.error.HTTPError as exc:
            raw = exc.read().decode("utf-8")
            try:
                payload = json.loads(raw) if raw else None
            except json.JSONDecodeError:
                payload = raw
            raise AssetApiError(
                f"asset API returned HTTP {exc.code}",
                status=exc.code,
                payload=payload,
            ) from exc
        except urllib.error.URLError as exc:
            raise AssetApiError(f"failed to reach asset API: {exc.reason}") from exc

    def healthz(self) -> dict[str, Any]:
        return self._request("GET", "/healthz")

    def workflow_install(self, workflow: dict[str, Any], *, dry_run: bool = False, skip_existing: bool = True) -> dict[str, Any]:
        return self._request(
            "POST",
            "/workflow/install",
            {
                "workflow": workflow,
                "dry_run": dry_run,
                "skip_existing": skip_existing,
            },
        )

    def workflow_analyze(self, workflow: dict[str, Any], *, skip_existing: bool = True) -> dict[str, Any]:
        return self._request(
            "POST",
            "/workflow/analyze",
            {
                "workflow": workflow,
                "skip_existing": skip_existing,
            },
        )

    def asset_fetch(
        self,
        *,
        url: str,
        kind: str,
        filename: str,
        dry_run: bool = False,
        skip_existing: bool = True,
    ) -> dict[str, Any]:
        return self._request(
            "POST",
            "/assets/fetch",
            {
                "url": url,
                "kind": kind,
                "filename": filename,
                "dry_run": dry_run,
                "skip_existing": skip_existing,
            },
        )

    def get_job(self, job_id: str) -> dict[str, Any]:
        return self._request("GET", f"/jobs/{job_id}")

    def cancel_job(self, job_id: str) -> dict[str, Any]:
        return self._request("POST", f"/jobs/{job_id}/cancel")
