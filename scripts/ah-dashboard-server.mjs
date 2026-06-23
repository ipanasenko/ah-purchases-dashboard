#!/usr/bin/env node

import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";

const API = "https://api.ah.nl";
const CLIENT_ID = "appie";
const BASE_HEADERS = {
  "User-Agent": "Appie/8.22.3",
  "Content-Type": "application/json",
  "Accept": "application/json",
  "x-application": "AHWEBSHOP",
};

function readArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith("--")) continue;
    args[key.slice(2)] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
  }
  return args;
}

function accessTokenFrom(tokenResponse) {
  return tokenResponse.access_token || tokenResponse.accessToken || tokenResponse.access?.token;
}

function refreshTokenFrom(tokenResponse) {
  return tokenResponse.refresh_token || tokenResponse.refreshToken || tokenResponse.refresh?.token;
}

async function readJsonFile(file) {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

async function writeJsonFile(file, data) {
  await fs.writeFile(file, JSON.stringify(data, null, 2));
}

async function refreshAuth(authFile) {
  const auth = await readJsonFile(authFile);
  const refreshToken = refreshTokenFrom(auth);
  if (!refreshToken) throw new Error("Saved AH auth has no refresh token.");

  const res = await fetch(`${API}/mobile-auth/v1/auth/token/refresh`, {
    method: "POST",
    headers: BASE_HEADERS,
    body: JSON.stringify({ clientId: CLIENT_ID, refreshToken }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`AH token refresh failed: ${res.status} ${res.statusText}`);

  const token = text ? JSON.parse(text) : {};
  const nextAuth = {
    source: "ah.nl mobile API",
    savedAt: new Date().toISOString(),
    access_token: accessTokenFrom(token),
    refresh_token: refreshTokenFrom(token) || refreshToken,
  };
  await writeJsonFile(authFile, nextAuth);
  return nextAuth.access_token;
}

async function fetchReceiptPdf(authFile, id) {
  const accessToken = await refreshAuth(authFile);
  const res = await fetch(`${API}/graphql`, {
    method: "POST",
    headers: {
      ...BASE_HEADERS,
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      operationName: "FetchPosReceiptPdf",
      variables: { id },
      query: "query FetchPosReceiptPdf($id: String!) { posReceiptPdf(id: $id) { pdfBase64 } }",
    }),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok || json?.errors?.length) {
    throw new Error(json?.errors?.[0]?.message || `AH PDF request failed: ${res.status} ${res.statusText}`);
  }
  return json?.data?.posReceiptPdf?.pdfBase64 || "";
}

function send(res, status, headers, body) {
  res.writeHead(status, headers);
  res.end(body);
}

async function main() {
  const args = readArgs(process.argv);
  const dashboardFile = path.resolve(String(args.dashboard || ""));
  const authFile = path.resolve(String(args["auth-file"] || "ah-auth.json"));
  const port = Number(args.port || 0);

  if (!dashboardFile) throw new Error("--dashboard is required.");

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
      if (url.pathname === "/" || url.pathname === "/dashboard") {
        const html = await fs.readFile(dashboardFile, "utf8");
        send(res, 200, { "Content-Type": "text/html; charset=utf-8" }, html);
        return;
      }
      if (url.pathname === "/api/receipt-pdf") {
        if (req.method === "OPTIONS") {
          send(res, 204, {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, OPTIONS",
          }, "");
          return;
        }
        const id = url.searchParams.get("id");
        if (!id) {
          send(res, 400, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }, JSON.stringify({ error: "Missing receipt id." }));
          return;
        }
        const pdfBase64 = await fetchReceiptPdf(authFile, id);
        send(res, 200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }, JSON.stringify({ pdfBase64 }));
        return;
      }
      send(res, 404, { "Content-Type": "text/plain; charset=utf-8" }, "Not found");
    } catch (error) {
      send(res, 500, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }, JSON.stringify({ error: error.message }));
    }
  });

  server.listen(port, "127.0.0.1", () => {
    const address = server.address();
    console.log(`AH dashboard server: http://127.0.0.1:${address.port}/dashboard`);
  });
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
