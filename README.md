# K0V0K Comfy Fetch

K0V0K Comfy Fetch is a ComfyUI custom-node plugin that adds a missing-model resolver panel to Workflow Overview. When a workflow or ComfyUI error entry exposes model download URLs, the plugin can send those URLs to a local fetch service, track progress, and refresh ComfyUI's missing-model state after downloads finish. We also support ranged file downloads where available, speeing up downloads more than 2x over merely downloading in the browser.

The goal is to support every Comfy model type that exposes downloadable hints to the user, not only common folders such as diffusion models, checkpoints, and LoRAs.

## Features

- Adds a `Resolve Missing Models` panel to the top of the Workflow Overview errors experience.
- Resolves workflow-linked model assets across Comfy model families when download URLs are available.
- Supports native Comfy model folders including checkpoints, LoRAs, text encoders, diffusion models, VAE families, background removal, detection, frame interpolation, geometry estimation, optical flow, and related model directories.
- Shows per-model progress, numeric percentages, progress bars, observed transfer rate, and ETA.
- Retries failed downloads up to five times per model.
- Supports cancellation for the current workflow's active resolution job.
- Refreshes missing-model errors after downloadable dependencies finish.
- Shows structured, user-facing errors for common provider, network, token, checksum, and disk-space failures.
- Uses a same-origin, server-issued session cookie for plugin routes. The frontend never reads or writes the cookie value.

## Requirements

- ComfyUI with the modern extension entrypoint API available through `comfy_api.latest`.
- Python 3.10 or newer.
- `aiohttp>=3.9`, installed automatically by `install.py` when supported by the installer.
- A running `comfy-asset-fetch-api` service reachable from the ComfyUI host.

By default, the plugin expects the asset fetch API at:

```text
http://127.0.0.1:8189
```

This repository contains the ComfyUI plugin UI and route bridge. The actual model download work is delegated to `comfy-asset-fetch-api`.

## Installation

Clone this repository directly into your ComfyUI `custom_nodes` directory:

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/k00v00k/k0v0k_comfy_fetch.git
```

Install Python dependencies if your Comfy installer does not run `install.py` automatically:

```bash
cd ComfyUI/custom_nodes/k0v0k_comfy_fetch
python install.py
```

Restart ComfyUI after installation.

The expected folder shape is:

```text
ComfyUI/custom_nodes/k0v0k_comfy_fetch/
  __init__.py
  install.py
  requirements.txt
  js/
  plugin/
  pyproject.toml
```

## Configuration

Create a JSON config file if you need to override the default API URL or token behavior:

```text
ComfyUI/custom_nodes/k0v0k_comfy_fetch/config/k0v0k-comfy-fetch.json
```

Example:

```json
{
  "asset_api_base_url": "http://127.0.0.1:8189",
  "asset_api_token_required": true
}
```

If the asset API requires a token, set the token in the ComfyUI process environment:

```bash
export COMFY_ASSET_API_TOKEN="replace-with-token"
```

Do not commit real tokens to this repository or to workflow files.

## How It Works

1. ComfyUI shows missing-model errors for the current workflow.
2. The plugin serializes the current workflow and looks for download hints in workflow metadata and Markdown notes.
3. The plugin submits the workflow to `comfy-asset-fetch-api`.
4. The fetch service downloads assets into the correct model folders.
5. The plugin receives job updates through ComfyUI websocket events.
6. When downloads complete, the plugin refreshes ComfyUI's missing-model view.

The plugin only resolves models when URLs are available. If ComfyUI can name a missing model but no download URL is exposed, the plugin will show that the model cannot be resolved automatically.

## Supported Model Types

K0V0K Comfy Fetch is designed around Comfy model folder names. Current supported folders include:

- `checkpoints`
- `loras`
- `vae`
- `vae_approx`
- `text_encoders`
- `audio_encoders`
- `clip`
- `clip_vision`
- `controlnet`
- `diffusion_models`
- `diffusers`
- `unet`
- `upscale_models`
- `latent_upscale_models`
- `embeddings`
- `background_removal`
- `detection`
- `frame_interpolation`
- `geometry_estimation`
- `gligen`
- `hypernetworks`
- `model_patches`
- `optical_flow`
- `photomaker`
- `style_models`
- `ipadapter`
- `insightface`

Additional model families can be added by mapping the Comfy folder name in both the plugin parser and the fetch service destination map.

## Route Protection

The plugin exposes local routes from the ComfyUI origin:

- `POST /k0v0k/comfy-fetch/bootstrap`
- `GET /k0v0k/comfy-fetch/status`
- `GET /k0v0k/comfy-fetch/jobs`
- `GET /k0v0k/comfy-fetch/jobs/{job_id}`
- `POST /k0v0k/comfy-fetch/jobs/{job_id}/cancel`
- `POST /k0v0k/comfy-fetch/analyze`
- `POST /k0v0k/comfy-fetch/resolve`

Routes are protected by a same-origin check and an ephemeral server-side cookie:

- `HttpOnly`
- `SameSite=Strict`
- path-scoped to `/k0v0k/comfy-fetch`
- generated in memory at ComfyUI startup

This is a practical local protection layer for a ComfyUI plugin. It is not a replacement for HTTPS-backed user authentication on public deployments. Do not expose ComfyUI or the asset fetch API directly to the public internet.

## Websocket Event

The plugin listens for this ComfyUI event:

```text
k0v0k.comfy-fetch.job_update
```

## Error Handling

The backend returns structured `error_details` objects with stable error codes. The UI maps those codes to user-facing text through `js/i18n.js`.

Common error codes include:

- `missing_huggingface_token`
- `huggingface_gated_model_access_required`
- `huggingface_access_forbidden`
- `huggingface_model_not_found`
- `missing_civitai_token`
- `civitai_access_forbidden`
- `provider_rate_limited`
- `provider_not_found`
- `provider_server_error`
- `network_timeout`
- `network_dns_failure`
- `network_connection_failed`
- `tls_ssl_error`
- `insufficient_free_space`
- `destination_write_failed`
- `checksum_mismatch`
- `aria2_unavailable`
- `retry_exhausted`
- `canceled_by_user`

## Localization

All user-facing UI copy should live in `js/i18n.js`.

The current catalog uses English as the default locale. The helper functions exported from that file provide:

- `t(key, values, fallback)` for ordinary translated strings
- `tPlural(key, count, values)` for count-aware strings
- `localizeError(errorInfo)` for structured download and provider errors

When adding or changing UI text:

- add the string to the locale catalog in `js/i18n.js`
- reference it from UI code by key
- keep backend error codes stable and map their display text through `localizeError`
- avoid hardcoding visible English text in `js/missing-input-resolver.js`

Future locales should be added by extending the same catalog keys used by the English default. A locale should be considered incomplete if it does not provide the same top-level sections and error-code mappings as English.

## Restart Behavior

- The plugin reloads when ComfyUI restarts.
- In-flight UI state is not persisted across a ComfyUI restart.
- The underlying fetch service is expected to mark persisted `queued` or `running` jobs as interrupted on restart.
- The fetch service can report recovered partial downloads through its `/healthz` endpoint, and the plugin displays that startup recovery state when available.

## Development

Verify the package structure:

```bash
npm run verify
```

Build a local package tarball:

```bash
npm pack
```

The package intentionally ignores generated artifacts such as `*.tgz`, `node_modules/`, `package-lock.json`, `__pycache__/`, and `*.pyc`.

## Project Metadata

Comfy Manager and Registry metadata are declared in `pyproject.toml`:

- node id: `k0v0k-comfy-fetch`
- display name: `K0V0K Comfy Fetch`
- publisher id: `k0v0k`

## Security

Please report security-sensitive issues privately if possible. Do not include API tokens, bearer tokens, cookies, workflow secrets, or private model credentials in public issues.

The plugin should never require users to paste Hugging Face, Civitai, or other provider tokens into the browser UI. Provider tokens belong in the server-side environment used by the fetch service.

## Contributing

Issues and pull requests are welcome. Useful contributions include:

- new Comfy model folder mappings
- provider-specific error handling
- additional i18n locales
- compatibility reports for current ComfyUI releases
- documentation for portable `comfy-asset-fetch-api` deployment

Before opening a pull request, run:

```bash
npm run verify
python -m py_compile install.py
```

## License

Apache License 2.0. See [LICENSE](LICENSE).
