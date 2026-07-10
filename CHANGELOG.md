# Changelog

## 0.1.0

- Initial `K0V0K Comfy Fetch` ComfyUI plugin bundle.
- Added a frontend extension that injects a missing-model resolver panel above the missing-model errors in Workflow Overview.
- Added server-side proxy routes that submit workflow install jobs to `comfy-asset-fetch`, track per-model state, emit websocket updates, and retry failed assets up to five times.
- Added top-of-panel placement, LoRA-friendly labeling, and byte-based progress plus ETA reporting.
- Added packaging helpers so the bundle can be packed into a standalone `k0v0k-comfy-fetch-comfyui-*.tgz` artifact.
