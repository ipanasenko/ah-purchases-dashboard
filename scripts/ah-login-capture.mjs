#!/usr/bin/env node

import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const LOGIN_URL = "https://login.ah.nl/secure/oauth/authorize?client_id=appie&redirect_uri=appie%3A%2F%2Flogin-exit&response_type=code";
const DEFAULT_TIMEOUT_MS = 180_000;
const APPIE_USER_AGENT = "Appie/8.22.3";

function readArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith("--")) continue;
    args[key.slice(2)] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
  }
  return args;
}

function extractOauthCode(value, { allowBareUuid = false } = {}) {
  const text = String(value || "").trim();
  if (!text) return "";

  try {
    const parsed = JSON.parse(text);
    const stack = [parsed];
    while (stack.length) {
      const item = stack.pop();
      if (typeof item === "string") {
        const code = extractOauthCode(item, { allowBareUuid });
        if (code) return code;
      } else if (item && typeof item === "object") {
        stack.push(...Object.values(item));
      }
    }
  } catch {
    // Not JSON; continue with string extraction.
  }

  const hasRedirectSignal = /appie:\/\/login-exit|login-exit|["']__N_REDIRECT["']|["']redirect/i.test(text);
  const urlMatch = hasRedirectSignal ? text.match(/[?&]code=([0-9a-fA-F-]{20,})/) : null;
  if (urlMatch) return decodeURIComponent(urlMatch[1]);

  if (!allowBareUuid) return "";

  const uuidMatch = text.match(/\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/);
  return uuidMatch ? uuidMatch[0] : "";
}

async function importPlaywright() {
  const candidates = [
    "playwright",
    process.env.PLAYWRIGHT_MODULE,
    process.env.CODEX_NODE_MODULES ? path.join(process.env.CODEX_NODE_MODULES, "playwright") : "",
    path.join(os.homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"),
  ].filter(Boolean);

  const require = createRequire(import.meta.url);
  for (const candidate of candidates) {
    try {
      let mod;
      if (path.isAbsolute(candidate)) {
        mod = await import(pathToFileURL(require.resolve(candidate)).href);
      } else {
        mod = await import(candidate);
      }
      return mod.default || mod;
    } catch {
      // Try the next known location.
    }
  }

  throw new Error("Playwright is not available. Install it for automatic AH login capture, or use the paste-code fallback.");
}

function waitForCode(page, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for AH login to finish."));
    }, timeoutMs);

    const check = (value) => {
      const code = extractOauthCode(value);
      if (!code) return;
      cleanup();
      resolve(code);
    };

    const onResponse = async (response) => {
      check(response.url());
      const contentType = response.headers()["content-type"] || "";
      if (!/json|text|html|javascript/i.test(contentType)) return;
      try {
        check(await response.text());
      } catch {
        // Some responses cannot be read by Playwright; URL capture is enough for most cases.
      }
    };

    const onRequest = (request) => check(request.url());
    const onFrameNavigated = (frame) => check(frame.url());

    function cleanup() {
      clearTimeout(timer);
      page.off("response", onResponse);
      page.off("request", onRequest);
      page.off("framenavigated", onFrameNavigated);
    }

    page.on("response", onResponse);
    page.on("request", onRequest);
    page.on("framenavigated", onFrameNavigated);
  });
}

async function main() {
  const args = readArgs(process.argv);
  const timeoutMs = Number(args.timeout || DEFAULT_TIMEOUT_MS);
  const loginUrl = String(args.url || LOGIN_URL);
  const { chromium } = await importPlaywright();

  const launchOptions = [
    { channel: "chrome" },
    { channel: "msedge" },
    {},
  ];
  let browser;
  const launchErrors = [];
  for (const options of launchOptions) {
    try {
      browser = await chromium.launch({
        ...options,
        headless: false,
        args: [`--user-agent=${APPIE_USER_AGENT}`],
      });
      break;
    } catch (error) {
      launchErrors.push(error.message);
    }
  }
  if (!browser) {
    throw new Error(`Could not launch a browser for AH login capture.\n${launchErrors.join("\n\n")}`);
  }

  try {
    const context = await browser.newContext({
      userAgent: APPIE_USER_AGENT,
      viewport: { width: 1100, height: 850 },
    });
    const page = await context.newPage();
    const codePromise = waitForCode(page, timeoutMs);

    console.error("AH login opened. Log in in the browser window; the code will be captured automatically.");
    const navigationPromise = page.goto(loginUrl, { waitUntil: "domcontentloaded" }).catch((error) => {
      const message = String(error.message || error);
      if (!message.includes("net::ERR_ABORTED")) {
        console.error(`AH login page navigation warning: ${message}`);
      }
    });
    const code = await codePromise;
    await navigationPromise;
    console.log(code);
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
