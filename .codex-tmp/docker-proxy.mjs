#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const result = spawnSync(
  "C:\\Windows\\System32\\wsl.exe",
  ["--exec", "docker", ...process.argv.slice(2)],
  { stdio: "inherit" },
);

process.exit(result.status ?? 1);
