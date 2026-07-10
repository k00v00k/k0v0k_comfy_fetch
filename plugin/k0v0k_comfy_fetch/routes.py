from __future__ import annotations

import json
from typing import Any

from aiohttp import web


_ROUTES_REGISTERED = False


def _json_response(payload: dict[str, Any], *, status: int = 200) -> web.Response:
    return web.json_response(payload, status=status)


def _require_auth(runtime, request) -> web.Response | None:
    if runtime.auth.is_request_authenticated(request) or runtime.auth.bootstrap_request_allowed(request):
        return None
    return _json_response(
        {
            "ok": False,
            "error": "plugin_auth_required",
        },
        status=401,
    )


def register_routes(runtime) -> None:
    global _ROUTES_REGISTERED
    if _ROUTES_REGISTERED:
        return
    from server import PromptServer

    routes = PromptServer.instance.routes

    @routes.post("/k0v0k/comfy-fetch/bootstrap")
    async def k0v0k_comfy_fetch_bootstrap(request):
        if not runtime.auth.bootstrap_request_allowed(request):
            return _json_response({"ok": False, "error": "plugin_auth_bootstrap_denied"}, status=403)
        response = _json_response({"ok": True, "service": "k0v0k-comfy-fetch"})
        runtime.auth.issue_cookie(response, request)
        return response

    @routes.get("/k0v0k/comfy-fetch/status")
    async def k0v0k_comfy_fetch_status(request):
        unauthorized = _require_auth(runtime, request)
        if unauthorized is not None:
            return unauthorized
        workflow_scope_id = str(request.query.get("workflow_scope_id", "")).strip() or None
        jobs = runtime.job_manager.list_jobs(workflow_scope_id=workflow_scope_id)
        active_job = next(
            (job for job in jobs if job.get("status") in {"queued", "running"}),
            jobs[0] if jobs else None,
        )
        health = runtime.job_manager._safe_health_report() or {}
        return _json_response(
            {
                "ok": True,
                "service": "k0v0k-comfy-fetch",
                "download_staging": health.get("download_staging"),
                "startup_recovery": health.get("startup_recovery"),
                "workflow_scope_id": workflow_scope_id,
                "active_job": active_job,
                "job_count": len(jobs),
            }
        )

    @routes.get("/k0v0k/comfy-fetch/jobs")
    async def k0v0k_comfy_fetch_jobs(request):
        unauthorized = _require_auth(runtime, request)
        if unauthorized is not None:
            return unauthorized
        workflow_scope_id = str(request.query.get("workflow_scope_id", "")).strip() or None
        return _json_response({"workflow_scope_id": workflow_scope_id, "jobs": runtime.job_manager.list_jobs(workflow_scope_id=workflow_scope_id)})

    @routes.get("/k0v0k/comfy-fetch/jobs/{job_id}")
    async def k0v0k_comfy_fetch_job(request):
        unauthorized = _require_auth(runtime, request)
        if unauthorized is not None:
            return unauthorized
        job_id = str(request.match_info["job_id"])
        job = runtime.job_manager.get_job(job_id)
        if not job:
            return _json_response({"ok": False, "error": "job_not_found"}, status=404)
        return _json_response(job)

    @routes.post("/k0v0k/comfy-fetch/jobs/{job_id}/cancel")
    async def k0v0k_comfy_fetch_cancel_job(request):
        unauthorized = _require_auth(runtime, request)
        if unauthorized is not None:
            return unauthorized
        job_id = str(request.match_info["job_id"])
        workflow_scope_id = str(request.query.get("workflow_scope_id", "")).strip() or None
        try:
            job = runtime.job_manager.cancel_job(job_id, workflow_scope_id=workflow_scope_id)
        except ValueError as exc:
            return _json_response({"ok": False, "error": str(exc)}, status=409)
        if not job:
            return _json_response({"ok": False, "error": "job_not_found"}, status=404)
        return _json_response({"ok": True, "job": job}, status=202)

    @routes.post("/k0v0k/comfy-fetch/analyze")
    async def k0v0k_comfy_fetch_analyze(request):
        unauthorized = _require_auth(runtime, request)
        if unauthorized is not None:
            return unauthorized
        try:
            payload = await request.json()
        except json.JSONDecodeError:
            return _json_response({"ok": False, "error": "invalid_json"}, status=400)
        if not isinstance(payload, dict):
            return _json_response({"ok": False, "error": "invalid_request_body"}, status=400)
        workflow = payload.get("workflow")
        if not isinstance(workflow, dict):
            return _json_response({"ok": False, "error": "workflow_required"}, status=400)
        try:
            analysis = runtime.client.workflow_analyze(workflow)
        except Exception as exc:
            return _json_response({"ok": False, "error": str(exc)}, status=502)
        return _json_response({"ok": True, "analysis": analysis})

    @routes.post("/k0v0k/comfy-fetch/resolve")
    async def k0v0k_comfy_fetch_resolve(request):
        unauthorized = _require_auth(runtime, request)
        if unauthorized is not None:
            return unauthorized
        try:
            payload = await request.json()
        except json.JSONDecodeError:
            return _json_response({"ok": False, "error": "invalid_json"}, status=400)
        if not isinstance(payload, dict):
            return _json_response({"ok": False, "error": "invalid_request_body"}, status=400)
        workflow = payload.get("workflow")
        if not isinstance(workflow, dict):
            return _json_response({"ok": False, "error": "workflow_required"}, status=400)
        workflow_scope_id = str(payload.get("workflow_scope_id", "")).strip() or None
        job = runtime.job_manager.start_resolution(workflow, workflow_scope_id=workflow_scope_id)
        return _json_response({"ok": True, "job": job}, status=202)

    _ROUTES_REGISTERED = True
