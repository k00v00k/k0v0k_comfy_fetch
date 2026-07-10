from __future__ import annotations

import json
import threading
import time
import uuid
from copy import deepcopy
from datetime import datetime, timezone
from typing import Any

from .asset_api import AssetApiError, ComfyAssetApiClient
from .config import K0V0KComfyFetchConfig


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_job_id() -> str:
    return f"k0v0k-comfy-fetch-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}-{uuid.uuid4().hex[:10]}"


def dependency_key(item: dict[str, Any]) -> str:
    return f"{item.get('kind', 'unknown')}::{item.get('filename', 'unknown')}"


def normalize_error_info(value: Any, *, fallback_message: str | None = None, fallback_code: str | None = None) -> dict[str, Any] | None:
    if isinstance(value, dict):
        normalized = deepcopy(value)
        if fallback_message and not normalized.get("message"):
            normalized["message"] = fallback_message
        if fallback_code and not normalized.get("code"):
            normalized["code"] = fallback_code
        return normalized
    if fallback_message or fallback_code:
        return {
            "code": fallback_code or "internal_fetch_error",
            "message": fallback_message or "",
        }
    return None


class MissingInputResolverJobManager:
    EVENT_NAME = "k0v0k.comfy-fetch.job_update"

    def __init__(self, *, client: ComfyAssetApiClient, config: K0V0KComfyFetchConfig, logger, emit_event):
        self.client = client
        self.config = config
        self.logger = logger
        self.emit_event = emit_event
        self._lock = threading.Lock()
        self._jobs: dict[str, dict[str, Any]] = {}
        self._cancel_events: dict[str, threading.Event] = {}

    def list_jobs(self, workflow_scope_id: str | None = None) -> list[dict[str, Any]]:
        with self._lock:
            jobs = sorted(
                (deepcopy(job) for job in self._jobs.values()),
                key=lambda item: item.get("created_at", ""),
                reverse=True,
            )
        if workflow_scope_id:
            jobs = [job for job in jobs if job.get("workflow_scope_id") == workflow_scope_id]
        return jobs

    def get_job(self, job_id: str) -> dict[str, Any] | None:
        with self._lock:
            job = self._jobs.get(job_id)
            return deepcopy(job) if job else None

    def start_resolution(self, workflow: dict[str, Any], *, workflow_scope_id: str | None = None) -> dict[str, Any]:
        job_id = new_job_id()
        health = self._safe_health_report()
        disk = (health or {}).get("download_staging")
        job = {
            "job_id": job_id,
            "workflow_scope_id": workflow_scope_id,
            "status": "queued",
            "phase": "queued",
            "created_at": utc_now(),
            "updated_at": utc_now(),
            "finished_at": None,
            "workflow_asset_job_id": None,
            "disk": disk,
            "summary": {
                "resolved_count": 0,
                "failed_count": 0,
                "pending_count": 0,
                "all_resolved": False,
            },
            "workflow": {
                "node_count": len(workflow.get("nodes", [])) if isinstance(workflow.get("nodes"), list) else None,
            },
            "items": [],
            "messages": [],
            "last_error": None,
            "progress": {
                "total_items": 0,
                "completed_items": 0,
                "failed_items": 0,
                "current_item": None,
                "known_total_bytes": None,
                "downloaded_bytes": 0,
                "percent_complete": None,
                "transfer_rate_bps": None,
                "eta_seconds": None,
            },
        }
        self._cancel_events[job_id] = threading.Event()
        self._set_job(job_id, job)
        thread = threading.Thread(
            target=self._run_job,
            args=(job_id, workflow),
            daemon=True,
            name=f"k0v0k-comfy-fetch-{job_id}",
        )
        thread.start()
        return self.get_job(job_id) or job

    def cancel_job(self, job_id: str, *, workflow_scope_id: str | None = None) -> dict[str, Any] | None:
        job = self.get_job(job_id)
        if not job:
            return None
        if workflow_scope_id and job.get("workflow_scope_id") != workflow_scope_id:
            raise ValueError("workflow_scope_mismatch")
        if job.get("status") in {"completed", "failed", "canceled"}:
            return job
        cancel_event = self._cancel_events.setdefault(job_id, threading.Event())
        cancel_event.set()
        job["cancel_requested_at"] = utc_now()
        job["status"] = "canceling" if job.get("status") in {"queued", "running", "partial"} else "canceled"
        self._append_message(job, "Cancel requested. Stopping active downloads.")

        asset_job_ids = set()
        if job.get("workflow_asset_job_id"):
            asset_job_ids.add(str(job["workflow_asset_job_id"]))
        for item in job.get("items", []):
            active_job_id = item.get("active_job_id")
            if active_job_id:
                asset_job_ids.add(str(active_job_id))
        for asset_job_id in sorted(asset_job_ids):
            try:
                self.client.cancel_job(asset_job_id)
            except Exception as exc:
                self.logger.warning("Failed to cancel asset API job %s for %s: %s", asset_job_id, job_id, exc)
        self._set_job(job_id, job)
        return self.get_job(job_id)

    def _safe_health_report(self) -> dict[str, Any] | None:
        try:
            health = self.client.healthz()
        except Exception as exc:
            self.logger.warning("Failed to query asset API healthz: %s", exc)
            return None
        return health if isinstance(health, dict) else None

    def _safe_disk_report(self) -> dict[str, Any] | None:
        health = self._safe_health_report()
        if not health:
            return None
        report = health.get("download_staging")
        return report if isinstance(report, dict) else None

    def _set_job(self, job_id: str, job: dict[str, Any]) -> dict[str, Any]:
        job["updated_at"] = utc_now()
        with self._lock:
            self._jobs[job_id] = deepcopy(job)
            snapshot = deepcopy(self._jobs[job_id])
        self.emit_event(self.EVENT_NAME, {"event": "job_update", "job": snapshot})
        return snapshot

    def _append_message(self, job: dict[str, Any], message: str) -> None:
        job.setdefault("messages", []).append({"ts": utc_now(), "message": message})

    def _clear_item_error(self, item: dict[str, Any]) -> None:
        item["last_error"] = None
        item["last_error_code"] = None
        item["last_error_info"] = None

    def _set_item_error(self, item: dict[str, Any], *, error_message: str | None = None, error_code: str | None = None, error_info: dict[str, Any] | None = None) -> None:
        normalized = normalize_error_info(error_info, fallback_message=error_message, fallback_code=error_code)
        item["last_error"] = error_message or (normalized or {}).get("message")
        item["last_error_code"] = error_code or (normalized or {}).get("code")
        item["last_error_info"] = normalized

    def _cancel_requested(self, job_id: str) -> bool:
        return self._cancel_events.get(job_id, threading.Event()).is_set()

    def _ensure_items(self, job: dict[str, Any], dependencies: list[dict[str, Any]]) -> None:
        if job["items"]:
            return
        target_sizes: dict[str, int] = {}
        storage_preflight = job.get("storage_preflight")
        if isinstance(storage_preflight, dict):
            for target in storage_preflight.get("targets", []):
                if not isinstance(target, dict):
                    continue
                target_sizes[dependency_key(target)] = int(target.get("required_bytes") or 0)
        items = []
        for dependency in dependencies:
            items.append(
                {
                    "key": dependency_key(dependency),
                    "name": dependency.get("filename"),
                    "filename": dependency.get("filename"),
                    "kind": dependency.get("kind"),
                    "url": dependency.get("url"),
                    "source": dependency.get("source"),
                    "origin": dependency.get("origin"),
                    "status": "pending",
                    "attempt_count": 0,
                    "retry_count": 0,
                    "max_retries": self.config.max_retries,
                    "active_job_id": None,
                    "transfer_mode": None,
                    "destination": None,
                    "range_supported": None,
                    "content_length": target_sizes.get(dependency_key(dependency)) or None,
                    "bytes_downloaded": 0,
                    "percent_complete": None,
                    "eta_seconds": None,
                    "last_progress_at": None,
                    "last_error": None,
                    "last_error_code": None,
                    "last_error_info": None,
                }
            )
        job["items"] = items
        self._recompute_summary(job)

    def _find_item(self, job: dict[str, Any], dependency: dict[str, Any]) -> dict[str, Any] | None:
        key = dependency_key(dependency)
        for item in job["items"]:
            if item["key"] == key:
                return item
        return None

    def _recompute_summary(self, job: dict[str, Any]) -> None:
        items = job.get("items", [])
        resolved = sum(1 for item in items if item.get("status") == "resolved")
        failed = sum(1 for item in items if item.get("status") == "failed")
        pending = sum(
            1
            for item in items
            if item.get("status") not in {"resolved", "failed"}
        )
        job["summary"] = {
            "resolved_count": resolved,
            "failed_count": failed,
            "pending_count": pending,
            "all_resolved": failed == 0 and pending == 0,
        }

    def _mark_workflow_results(self, job: dict[str, Any], workflow_job: dict[str, Any]) -> None:
        if isinstance(workflow_job.get("progress"), dict):
            job["progress"] = deepcopy(workflow_job["progress"])
        dependencies = workflow_job.get("dependencies", [])
        if isinstance(dependencies, list):
            self._ensure_items(job, [item for item in dependencies if isinstance(item, dict)])
        current_item = ((workflow_job.get("progress") or {}).get("current_item") or {})
        if isinstance(current_item, dict) and current_item.get("filename"):
            item = self._find_item(job, current_item)
            if item and item["status"] not in {"resolved", "failed"}:
                item["status"] = current_item.get("stage", "downloading")
                item["active_job_id"] = workflow_job.get("job_id")
                item["bytes_downloaded"] = current_item.get("bytes_downloaded") or 0
                item["content_length"] = current_item.get("total_bytes") or item.get("content_length")
                item["percent_complete"] = current_item.get("percent_complete")
                item["eta_seconds"] = current_item.get("eta_seconds")
                item["last_progress_at"] = current_item.get("last_progress_at") or item.get("last_progress_at")
        if isinstance(job.get("progress"), dict) and isinstance((workflow_job.get("progress") or {}), dict):
            job["progress"]["last_progress_at"] = (workflow_job.get("progress") or {}).get("last_progress_at") or job["progress"].get("last_progress_at")

        results = workflow_job.get("results", [])
        if isinstance(results, list):
            for result in results:
                if not isinstance(result, dict):
                    continue
                item = self._find_item(job, result)
                if not item:
                    continue
                item["attempt_count"] = max(item["attempt_count"], 1)
                item["status"] = "resolved"
                item["active_job_id"] = workflow_job.get("job_id")
                item["transfer_mode"] = result.get("transfer_mode")
                item["destination"] = result.get("destination") or result.get("path")
                item["range_supported"] = result.get("range_supported")
                item["content_length"] = result.get("content_length") or result.get("size_bytes") or item.get("content_length")
                item["bytes_downloaded"] = result.get("size_bytes") or result.get("content_length") or item.get("content_length") or 0
                item["percent_complete"] = 100.0
                item["eta_seconds"] = 0
                self._clear_item_error(item)

        failures = workflow_job.get("failures", [])
        if isinstance(failures, list):
            for failure in failures:
                if not isinstance(failure, dict):
                    continue
                item = self._find_item(job, failure)
                if not item:
                    continue
                item["attempt_count"] = max(item["attempt_count"], 1)
                item["status"] = "retry_queued"
                item["active_job_id"] = workflow_job.get("job_id")
                self._set_item_error(
                    item,
                    error_message=failure.get("error_message") or workflow_job.get("error"),
                    error_code=failure.get("error_code") or workflow_job.get("error"),
                    error_info=failure.get("error_details"),
                )
        self._recompute_summary(job)

    def _poll_asset_job(self, asset_job_id: str, job: dict[str, Any], dependency: dict[str, Any], *, retrying: bool = False) -> dict[str, Any]:
        item = self._find_item(job, dependency)
        if item:
            item["status"] = "retrying" if retrying else "downloading"
            item["active_job_id"] = asset_job_id
            self._recompute_summary(job)
            self._set_job(job["job_id"], job)
        while True:
            if self._cancel_requested(job["job_id"]):
                try:
                    self.client.cancel_job(asset_job_id)
                except Exception:
                    pass
                return {"status": "canceled", "error": "canceled_by_user", "results": [], "failures": []}
            snapshot = self.client.get_job(asset_job_id)
            current_item = ((snapshot.get("progress") or {}).get("current_item") or {})
            if item:
                item["bytes_downloaded"] = current_item.get("bytes_downloaded") or item.get("bytes_downloaded") or 0
                item["content_length"] = current_item.get("total_bytes") or item.get("content_length")
                item["percent_complete"] = current_item.get("percent_complete")
                item["eta_seconds"] = current_item.get("eta_seconds")
                item["last_progress_at"] = current_item.get("last_progress_at") or item.get("last_progress_at")
                if isinstance(current_item, dict) and current_item.get("stage"):
                    item["status"] = current_item.get("stage", item["status"])
            if isinstance(job.get("progress"), dict):
                job["progress"]["last_progress_at"] = (snapshot.get("progress") or {}).get("last_progress_at") or job["progress"].get("last_progress_at")
            self._set_job(job["job_id"], job)
            if snapshot.get("status") in {"completed", "failed", "partial"}:
                return snapshot
            if snapshot.get("status") == "canceled":
                return snapshot
            time.sleep(self.config.job_poll_seconds)

    def _retry_failed_items(self, job: dict[str, Any]) -> None:
        for item in job["items"]:
            if self._cancel_requested(job["job_id"]):
                return
            if item.get("status") != "retry_queued":
                continue
            dependency = {
                "url": item.get("url"),
                "kind": item.get("kind"),
                "filename": item.get("filename"),
            }
            while item["retry_count"] < self.config.max_retries and item.get("status") != "resolved":
                if self._cancel_requested(job["job_id"]):
                    return
                item["retry_count"] += 1
                item["attempt_count"] += 1
                self._append_message(
                    job,
                    f"Retry {item['retry_count']} for {item['filename']}",
                )
                self._set_job(job["job_id"], job)
                try:
                    accepted = self.client.asset_fetch(
                        url=str(item["url"]),
                        kind=str(item["kind"]),
                        filename=str(item["filename"]),
                        dry_run=False,
                        skip_existing=True,
                    )
                    snapshot = self._poll_asset_job(
                        str(accepted["job_id"]),
                        job,
                        dependency,
                        retrying=True,
                    )
                except AssetApiError as exc:
                    self._set_item_error(
                        item,
                        error_message=str(exc),
                        error_code="internal_fetch_error",
                        error_info=normalize_error_info(getattr(exc, "payload", None), fallback_message=str(exc), fallback_code="internal_fetch_error"),
                    )
                    snapshot = {"status": "failed", "error": str(exc), "results": [], "failures": []}

                if snapshot.get("status") == "canceled":
                    return

                results = snapshot.get("results", [])
                if isinstance(results, list):
                    for result in results:
                        if not isinstance(result, dict):
                            continue
                        item["status"] = "resolved"
                        item["transfer_mode"] = result.get("transfer_mode")
                        item["destination"] = result.get("destination") or result.get("path")
                        item["range_supported"] = result.get("range_supported")
                        self._clear_item_error(item)
                        break

                if item["status"] == "resolved":
                    break

                failures = snapshot.get("failures", [])
                if isinstance(failures, list) and failures:
                    failure = failures[0]
                    if isinstance(failure, dict):
                        self._set_item_error(
                            item,
                            error_message=failure.get("error_message") or snapshot.get("error"),
                            error_code=failure.get("error_code") or snapshot.get("error"),
                            error_info=failure.get("error_details"),
                        )
                else:
                    self._set_item_error(
                        item,
                        error_message=snapshot.get("error"),
                        error_code=snapshot.get("error"),
                        error_info=snapshot.get("error_details"),
                    )

                if item["retry_count"] >= self.config.max_retries:
                    item["status"] = "failed"
                    break
                item["status"] = "retry_queued"
                self._set_job(job["job_id"], job)

        self._recompute_summary(job)

    def _run_job(self, job_id: str, workflow: dict[str, Any]) -> None:
        job = self.get_job(job_id)
        if not job:
            return
        if self._cancel_requested(job_id):
            job["status"] = "canceled"
            job["phase"] = "canceled"
            job["finished_at"] = utc_now()
            job["last_error"] = "canceled_by_user"
            job["last_error_info"] = {"code": "canceled_by_user", "message": "Resolver canceled before work began."}
            self._append_message(job, "Resolver canceled before work began.")
            self._set_job(job_id, job)
            return
        job["status"] = "running"
        job["phase"] = "planning"
        self._append_message(job, "Submitted workflow dependency resolution.")
        self._set_job(job_id, job)
        try:
            accepted = self.client.workflow_install(workflow, dry_run=False, skip_existing=True)
            workflow_asset_job_id = str(accepted["job_id"])
            job["workflow_asset_job_id"] = workflow_asset_job_id
            job["phase"] = "workflow_install"
            if isinstance(accepted.get("storage_preflight"), dict):
                job["storage_preflight"] = accepted.get("storage_preflight")
            self._set_job(job_id, job)
            while True:
                if self._cancel_requested(job_id):
                    try:
                        self.client.cancel_job(workflow_asset_job_id)
                    except Exception:
                        pass
                    job["status"] = "canceled"
                    job["phase"] = "canceled"
                    job["last_error"] = "canceled_by_user"
                    job["last_error_info"] = {"code": "canceled_by_user", "message": "Resolver canceled during workflow dependency download."}
                    job["finished_at"] = utc_now()
                    self._append_message(job, "Resolver canceled during workflow dependency download.")
                    self._set_job(job_id, job)
                    return
                workflow_job = self.client.get_job(workflow_asset_job_id)
                self._mark_workflow_results(job, workflow_job)
                self._set_job(job_id, job)
                if workflow_job.get("status") in {"completed", "failed", "partial", "canceled"}:
                    break
                time.sleep(self.config.job_poll_seconds)

            if workflow_job.get("status") == "canceled":
                job["status"] = "canceled"
                job["phase"] = "canceled"
                job["last_error"] = "canceled_by_user"
                job["last_error_info"] = {"code": "canceled_by_user", "message": "Resolver canceled during workflow dependency download."}
                job["finished_at"] = utc_now()
                self._append_message(job, "Resolver canceled during workflow dependency download.")
                self._set_job(job_id, job)
                return

            self._retry_failed_items(job)
            if self._cancel_requested(job_id):
                job["status"] = "canceled"
                job["phase"] = "canceled"
                job["last_error"] = "canceled_by_user"
                job["last_error_info"] = {"code": "canceled_by_user", "message": "Resolver canceled during retry cleanup."}
                job["finished_at"] = utc_now()
                self._append_message(job, "Resolver canceled during retry cleanup.")
                self._set_job(job_id, job)
                return
            self._recompute_summary(job)
            if job["summary"]["failed_count"] == 0:
                job["status"] = "completed"
                job["phase"] = "done"
                job["last_error_info"] = None
                self._append_message(job, "All downloadable models and dependencies resolved.")
            else:
                job["status"] = "partial"
                job["phase"] = "done"
                job["last_error_info"] = {"code": "retry_exhausted", "message": "Some models or dependencies failed after the retry limit."}
                self._append_message(job, "Some models or dependencies failed after the retry limit.")
            job["finished_at"] = utc_now()
            self._set_job(job_id, job)
        except Exception as exc:
            job["status"] = "failed"
            job["phase"] = "failed"
            job["last_error"] = f"{type(exc).__name__}: {exc}"
            job["last_error_info"] = normalize_error_info(getattr(exc, "payload", None), fallback_message=str(exc), fallback_code="internal_fetch_error")
            job["finished_at"] = utc_now()
            self._append_message(job, f"Resolver failed: {exc}")
            self._set_job(job_id, job)
