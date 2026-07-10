import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const required = [
  "__init__.py",
  "install.py",
  "package.json",
  "pyproject.toml",
  "requirements.txt",
  "README.md",
  "CHANGELOG.md",
  "js/missing-input-resolver.js",
  "plugin/k0v0k_comfy_fetch/bootstrap.py",
  "plugin/k0v0k_comfy_fetch/routes.py",
  "plugin/k0v0k_comfy_fetch/job_manager.py",
  "plugin/k0v0k_comfy_fetch/asset_api.py"
];

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(scriptDir, "..");
const missing = required.filter((relativePath) => !fs.existsSync(path.join(packageRoot, relativePath)));

if (missing.length) {
  console.error("Missing required package files:");
  for (const relativePath of missing) {
    console.error(`- ${relativePath}`);
  }
  process.exit(1);
}

console.log("ComfyUI extension package structure looks valid.");
