import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(scriptDir, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf8"));
const tarballName = packageJson.name
  .replace(/^@/, "")
  .replace(/\//g, "-")
  .replace(/[^a-zA-Z0-9._-]/g, "-")
  + `-${packageJson.version}.tgz`;

const sourcePath = path.join(packageRoot, tarballName);
const targetDir = "/Volumes/SP2/HomeLab/installers/ComfyUI";
const targetPath = path.join(targetDir, tarballName);

if (!fs.existsSync(sourcePath)) {
  console.error(`Tarball not found: ${sourcePath}`);
  process.exit(1);
}

fs.mkdirSync(targetDir, { recursive: true });
fs.copyFileSync(sourcePath, targetPath);
console.log(`Copied ${tarballName} to ${targetPath}`);
