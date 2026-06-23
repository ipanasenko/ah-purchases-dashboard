#!/usr/bin/env node

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

function usage() {
  console.log(`Usage:
  node ah-show-dashboard.mjs --months 3 [--auth-file ah-auth.json] [--out-dir outputs]
  node ah-show-dashboard.mjs --months 3 --code OAUTH_CODE [--auth-file ah-auth.json] [--out-dir outputs]
  node ah-show-dashboard.mjs --months 3 --token 'appie://login-exit?code=...' [--auth-file ah-auth.json] [--out-dir outputs]

Creates:
  ah-receipts.json
  ah-purchase-dashboard-with-data.html

Auth:
  Prefer --auth-file ah-auth.json after the first login. If you do not have it yet, pass --code.
  If no auth file or code is available, this script opens AH login and captures the code automatically.
  --code, --token, and --redirect may be a bare code, a full appie:// redirect URL, or copied login JSON.
  This script prints the generated dashboard file URL instead of opening an external browser.
`);
}

function readArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith("--")) continue;
    args[key.slice(2)] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
  }
  return args;
}

function runNode(args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      stdio: "inherit",
      ...options,
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${args.join(" ")} exited with code ${code}`));
    });
  });
}

function runNodeCaptureStdout(args, options = {}) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    const child = spawn(process.execPath, args, {
      stdio: ["ignore", "pipe", "inherit"],
      ...options,
    });
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`${args.join(" ")} exited with code ${code}`));
    });
  });
}

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function firstExisting(files) {
  for (const file of files) {
    if (await exists(file)) return file;
  }
  return null;
}

function extractOauthCode(value) {
  const text = String(value || "").trim();
  if (!text) return "";

  try {
    const parsed = JSON.parse(text);
    const stack = [parsed];
    while (stack.length) {
      const item = stack.pop();
      if (typeof item === "string") {
        const code = extractOauthCode(item);
        if (code) return code;
      } else if (item && typeof item === "object") {
        stack.push(...Object.values(item));
      }
    }
  } catch {
    // Not JSON; continue with string extraction.
  }

  const urlMatch = text.match(/[?&]code=([0-9a-fA-F-]{20,})/);
  if (urlMatch) return decodeURIComponent(urlMatch[1]);

  const uuidMatch = text.match(/\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/);
  if (uuidMatch) return uuidMatch[0];

  return text;
}

async function embedDashboard(templateFile, receiptsFile, outFile) {
  const html = await fs.readFile(templateFile, "utf8");
  const data = await fs.readFile(receiptsFile, "utf8");
  const marker = "const state = { receipts: [], rows: [] };";
  if (!html.includes(marker)) {
    throw new Error(`Dashboard template is missing expected marker: ${marker}`);
  }
  const embedded = html.replace(
    marker,
    `const embeddedData = ${data};\n      const state = { receipts: parseReceipts(embeddedData), rows: [] };`,
  );
  await fs.writeFile(outFile, embedded);
}

async function main() {
  const args = readArgs(process.argv);
  if (args.help) {
    usage();
    return;
  }

  const months = String(args.months || 3);
  const outDir = path.resolve(String(args["out-dir"] || "outputs"));
  const authFile = path.resolve(String(args["auth-file"] || "ah-auth.json"));
  const receiptsFile = path.join(outDir, "ah-receipts.json");
  const dashboardFile = path.join(outDir, "ah-purchase-dashboard-with-data.html");
  const fetchScript = path.join(scriptDir, "ah-fetch-receipts.mjs");
  const loginCaptureScript = path.join(scriptDir, "ah-login-capture.mjs");
  const templateFile = await firstExisting([
    path.join(scriptDir, "ah-purchase-dashboard.html"),
    path.join(scriptDir, "..", "assets", "ah-purchase-dashboard.html"),
  ]);

  if (!templateFile) {
    throw new Error("Could not find ah-purchase-dashboard.html next to the script or in ../assets.");
  }

  await fs.mkdir(outDir, { recursive: true });

  const fetchArgs = [
    fetchScript,
    "--months",
    months,
    "--out",
    receiptsFile,
    "--auth-out",
    authFile,
  ];

  const pastedCode = args.code || args.token || args.redirect;

  if (pastedCode) {
    fetchArgs.push("--code", extractOauthCode(pastedCode));
  } else if (await exists(authFile)) {
    fetchArgs.push("--auth-file", authFile);
  } else {
    console.error("No reusable AH auth file found. Opening AH login to capture a fresh login code...");
    try {
      const loginCaptureArgs = [loginCaptureScript];
      if (args["login-timeout"]) loginCaptureArgs.push("--timeout", String(args["login-timeout"]));
      const code = extractOauthCode(await runNodeCaptureStdout(loginCaptureArgs));
      if (!code) throw new Error("AH login finished but no OAuth code was captured.");
      fetchArgs.push("--code", code);
    } catch (error) {
      throw new Error(`Automatic AH login capture failed: ${error.message}

Fallback: ask the user to open the AH login URL and paste the redirect URL or code, then run this script again internally with --code, --token, or --redirect.`);
    }
  }

  await runNode(fetchArgs);
  await embedDashboard(templateFile, receiptsFile, dashboardFile);

  console.log(`Dashboard: ${dashboardFile}`);
  console.log(`Dashboard URL: ${pathToFileURL(dashboardFile).href}`);
  console.log(`Receipts: ${receiptsFile}`);
  if (args.open) {
    console.error("--open is deprecated and ignored to avoid launching an external browser from the skill.");
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
