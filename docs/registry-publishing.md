# Comfy Registry Publishing

Comfy-Fetch is prepared for the modern Comfy Registry publishing path.

## Registry Metadata

- Repository: `https://github.com/k00v00k/k0v0k_comfy_fetch`
- Package id: `comfy-fetch`
- Display name: `Comfy-Fetch`
- Publisher id: `k00v00k`
- Python support: `>=3.10`
- License: Apache-2.0

The registry metadata lives in `pyproject.toml`.

## Required GitHub Secret

Add this repository secret before publishing:

```text
REGISTRY_ACCESS_TOKEN
```

The value is the Comfy Registry publishing API key. Do not commit the token, print it in workflow logs, or store it in `.env` files.

## Publish Flow

The workflow at `.github/workflows/publish_action.yml` publishes when `pyproject.toml` changes on `main`.

Manual publish:

1. Confirm `REGISTRY_ACCESS_TOKEN` exists in GitHub Actions secrets.
2. Confirm the Comfy Registry publisher id `k0v0k` exists.
3. Bump `version` in `pyproject.toml`.
4. Merge the version bump to `main`, or run the workflow manually from GitHub Actions.

Registry releases should be treated as immutable. Bump the version for every new Registry publish.

## Local Metadata Validation

Run:

```bash
python - <<'PY'
import tomllib
with open("pyproject.toml", "rb") as f:
    tomllib.load(f)
print("pyproject.toml ok")
PY
python -m compileall .
npm run verify
```

## ComfyUI-Manager Fallback PR

The preferred discovery path is the Comfy Registry. If Manager discovery lags or legacy visibility is still needed, prepare a pull request to `Comfy-Org/ComfyUI-Manager`.

Suggested legacy entry:

```json
{
  "title": "Comfy-Fetch",
  "name": "comfy-fetch",
  "reference": "https://github.com/k00v00k/k0v0k_comfy_fetch",
  "files": [
    "https://github.com/k00v00k/k0v0k_comfy_fetch"
  ],
  "install_type": "git",
  "description": "Fetch, cache, and manage remote assets and model artifacts for ComfyUI workflows.",
  "tags": [
    "asset",
    "fetch",
    "cache",
    "models",
    "workflow",
    "utility"
  ],
  "pip": [
    "aiohttp>=3.9"
  ]
}
```

Before submitting a Manager PR:

1. Inspect the current Manager docs to find the correct custom-node list file.
2. Add the entry to only the documented list file.
3. Validate JSON with `python -m json.tool`.
4. Search for duplicate `comfy-fetch` entries.
5. Confirm this repository is public and the README includes installation, usage, dependencies, and security notes.

Do not submit the Manager PR until Registry metadata, installation, and tests are clean.
