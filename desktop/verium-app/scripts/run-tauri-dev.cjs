const { spawnSync } = require("node:child_process");
const path = require("node:path");

const root = path.join(__dirname, "..");

if (process.platform === "win32") {
  const ps1 = path.join(__dirname, "tauri-dev.ps1");
  const result = spawnSync(
    "powershell",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      ps1,
    ],
    { stdio: "inherit", cwd: root },
  );
  process.exit(result.status ?? 1);
}

const result = spawnSync("npx", ["tauri", "dev"], {
  stdio: "inherit",
  cwd: root,
  shell: true,
});
process.exit(result.status ?? 1);
