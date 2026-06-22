#!/usr/bin/env node

const API = "https://api.ah.nl";
const CLIENT_ID = "appie";
const BASE_HEADERS = {
  "User-Agent": "Appie/8.22.3",
  "Content-Type": "application/json",
  "Accept": "application/json",
  "x-application": "AHWEBSHOP",
};

function usage() {
  console.log(`Usage:
  node ah-fetch-receipts.mjs --code OAUTH_CODE [--months 3] [--out ah-receipts.json]
  node ah-fetch-receipts.mjs --refresh-token TOKEN [--months 3] [--out ah-receipts.json]
  node ah-fetch-receipts.mjs --access-token TOKEN [--months 3] [--out ah-receipts.json]
  node ah-fetch-receipts.mjs --auth-file ah-auth.json [--months 3] [--out ah-receipts.json]

Advanced endpoint overrides:
  --receipt-list-url URL
  --receipt-detail-url-template URL_WITH_{transactionId}
  --legacy-rest

Get an OAuth code by opening:
https://login.ah.nl/secure/oauth/authorize?client_id=appie&redirect_uri=appie://login-exit&response_type=code

After login, copy the code from the appie://login-exit?code=... redirect.
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

function normalizeCode(value) {
  if (!value) return value;
  const input = String(value).trim();
  if (!input.includes("code=")) return input;
  const query = input.includes("?") ? input.slice(input.indexOf("?") + 1) : input;
  return new URLSearchParams(query).get("code") || input;
}

function accessTokenFrom(tokenResponse) {
  return tokenResponse.access_token || tokenResponse.accessToken || tokenResponse.access?.token;
}

function refreshTokenFrom(tokenResponse) {
  return tokenResponse.refresh_token || tokenResponse.refreshToken || tokenResponse.refresh?.token;
}

async function request(path, { method = "GET", token, body } = {}) {
  const url = path.startsWith("http") ? path : `${API}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      ...BASE_HEADERS,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${method} ${path} failed: ${res.status} ${res.statusText}\n${text}`);
  }
  return text ? JSON.parse(text) : null;
}

async function requestAny(paths, options) {
  const errors = [];
  for (const path of paths) {
    try {
      return { path, data: await request(path, options) };
    } catch (error) {
      errors.push(String(error.message));
      if (!String(error.message).includes("404 Not Found")) break;
    }
  }
  throw new Error(errors.join("\n\n"));
}

async function graphqlRequest(operationName, query, variables, token) {
  const res = await fetch(`${API}/graphql`, {
    method: "POST",
    headers: {
      ...BASE_HEADERS,
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ operationName, variables, query }),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok || json?.errors?.length) {
    throw new Error(`GraphQL ${operationName} failed: ${res.status} ${res.statusText}\n${text}`);
  }
  return json.data;
}

const POS_RECEIPTS_PAGE_QUERY = `query FetchPosReceiptsPage($pagination: OffsetLimitPagination!) {
  posReceiptsPage(pagination: $pagination) {
    pagination {
      totalElements
      offset
      limit
    }
    posReceipts {
      id
      totalAmount {
        amount
      }
      storeAddress {
        street
        city
        postalCode
      }
    }
  }
}`;

const POS_RECEIPT_DETAILS_QUERY = `query FetchPosReceiptsDetails($id: String!) {
  posReceiptDetails(id: $id) {
    id
    transaction {
      id
      dateTime
    }
    total {
      amount
    }
    subtotalProducts {
      amount {
        amount
      }
    }
    subtotalDiscount {
      amount
    }
    discountTotal {
      amount
    }
    discountPersonal {
      amount {
        amount
      }
    }
    products {
      id
      name
      quantity
      amount {
        amount
      }
      price {
        amount
      }
      weight {
        amount
        unit
      }
      deposit {
        amount
      }
      packageTax {
        amount
      }
      indicators {
        name
      }
    }
    discounts {
      amount {
        amount
      }
    }
    payments {
      amount {
        amount
      }
    }
    returnPayment {
      amount {
        amount
      }
    }
    change {
      amount
    }
    vat {
      total {
        amount {
          amount
        }
        salesAmount {
          amount
        }
      }
      levels {
        amount {
          amount
        }
        salesAmount {
          amount
        }
      }
    }
  }
}`;

function parseAhDateTime(value) {
  if (!value) return null;
  const normalized = String(value).replace(" ", "T");
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function receiptDate(receipt) {
  return parseAhDateTime(receipt?.detail?.transaction?.dateTime || receipt?.transaction?.dateTime);
}

async function fetchGraphqlReceipts(accessToken, cutoff, months) {
  const pageSize = 20;
  const receipts = [];
  let offset = 0;
  let totalElements = Infinity;
  let shouldStop = false;

  while (offset < totalElements && !shouldStop) {
    console.error(`Fetching receipt page offset ${offset}...`);
    const data = await graphqlRequest(
      "FetchPosReceiptsPage",
      POS_RECEIPTS_PAGE_QUERY,
      { pagination: { offset, limit: pageSize } },
      accessToken,
    );
    const page = data.posReceiptsPage;
    totalElements = page.pagination?.totalElements ?? totalElements;

    for (const summary of page.posReceipts || []) {
      console.error(`Fetching receipt detail: ${summary.id}`);
      const detailData = await graphqlRequest(
        "FetchPosReceiptsDetails",
        POS_RECEIPT_DETAILS_QUERY,
        { id: summary.id },
        accessToken,
      );
      const detail = detailData.posReceiptDetails;
      const combined = {
        ...summary,
        transactionId: summary.id,
        transactionMoment: detail.transaction?.dateTime,
        totalAmount: summary.totalAmount?.amount ?? detail.total?.amount,
        detail,
      };
      const date = receiptDate(combined);
      if (date && date < cutoff) {
        shouldStop = true;
        break;
      }
      receipts.push(combined);
    }

    offset += page.pagination?.limit || pageSize;
  }

  console.error(`Found ${receipts.length} receipts since ${cutoff.toISOString().slice(0, 10)}.`);
  return {
    source: "ah.nl mobile GraphQL API",
    fetchedAt: new Date().toISOString(),
    months,
    receipts,
  };
}

async function tokenFromCode(code) {
  try {
    return await request("/mobile-auth/v1/auth/token", {
      method: "POST",
      body: { clientId: CLIENT_ID, code },
    });
  } catch (error) {
    if (String(error.message).includes("400 Bad Request")) {
      throw new Error(`${error.message}

The OAuth code was rejected by AH. Generate a fresh code and run the command immediately.
If normal browser login keeps producing rejected codes, open the login URL with the Appie user agent:

  open -na "Google Chrome" --args --user-agent="Appie/8.22.3" "https://login.ah.nl/secure/oauth/authorize?client_id=appie&redirect_uri=appie://login-exit&response_type=code"

Then copy the code from the appie://login-exit?code=... redirect and pass it in quotes.`);
    }
    throw error;
  }
}

async function tokenFromRefresh(refreshToken) {
  return request("/mobile-auth/v1/auth/token/refresh", {
    method: "POST",
    body: { clientId: CLIENT_ID, refreshToken },
  });
}

async function readJsonFile(path) {
  const fs = await import("node:fs/promises");
  return JSON.parse(await fs.readFile(path, "utf8"));
}

async function writeJsonFile(path, data) {
  const fs = await import("node:fs/promises");
  await fs.writeFile(path, JSON.stringify(data, null, 2));
}

function cutoffDate(months) {
  const date = new Date();
  date.setMonth(date.getMonth() - months);
  return date;
}

async function main() {
  const args = readArgs(process.argv);
  if (args.help || (!args.code && !args["refresh-token"] && !args["access-token"] && !args["auth-file"])) {
    usage();
    process.exit(args.help ? 0 : 1);
  }

  const months = Number(args.months || 3);
  const out = args.out || "ah-receipts.json";
  const authOut = args["auth-out"] || "ah-auth.json";
  const cutoff = cutoffDate(months);

  let accessToken = args["access-token"];
  let refreshToken = args["refresh-token"];
  if (args["auth-file"]) {
    const auth = await readJsonFile(args["auth-file"]);
    accessToken = accessTokenFrom(auth);
    refreshToken = refreshTokenFrom(auth);
    if (refreshToken) {
      const token = await tokenFromRefresh(refreshToken);
      accessToken = accessTokenFrom(token);
      refreshToken = refreshTokenFrom(token);
    }
  } else if (args.code) {
    const token = await tokenFromCode(normalizeCode(args.code));
    accessToken = accessTokenFrom(token);
    refreshToken = refreshTokenFrom(token);
  } else if (refreshToken) {
    const token = await tokenFromRefresh(refreshToken);
    accessToken = accessTokenFrom(token);
    refreshToken = refreshTokenFrom(token);
  }

  if (!accessToken) {
    throw new Error("AH did not return an access token. Check that the OAuth code is fresh and was copied without shell characters such as unquoted &.");
  }

  await writeJsonFile(authOut, {
    source: "ah.nl mobile API",
    savedAt: new Date().toISOString(),
    access_token: accessToken,
    refresh_token: refreshToken,
  });
  console.error(`Saved auth tokens to ${authOut}. Keep this file private.`);

  if (!args["legacy-rest"]) {
    const exportData = await fetchGraphqlReceipts(accessToken, cutoff, months);
    await writeJsonFile(out, exportData);
    console.error(`Wrote ${out}`);
    return;
  }

  console.error("Fetching receipt list...");
  const receiptListPaths = [
    ...(args["receipt-list-url"] ? [args["receipt-list-url"]] : []),
    "/mobile-services/v1/receipts",
    "/mobile-services/v2/receipts",
    "/mobile-services/receipts/v1",
    "/mobile-services/receipts/v2",
    "/receipt/v1/receipts",
    "/receipts/v1",
  ];
  const receiptResult = await requestAny(receiptListPaths, { token: accessToken });
  console.error(`Receipt list endpoint: ${receiptResult.path}`);
  const receiptResponse = receiptResult.data;
  const receiptList = Array.isArray(receiptResponse)
    ? receiptResponse
    : receiptResponse.receipts || receiptResponse.data || receiptResponse.items || [];
  const recent = receiptList.filter((receipt) => new Date(receipt.transactionMoment) >= cutoff);
  console.error(`Found ${recent.length} receipts since ${cutoff.toISOString().slice(0, 10)}.`);

  const detailedReceipts = [];
  for (const [index, receipt] of recent.entries()) {
    const id = receipt.transactionId;
    console.error(`Fetching receipt ${index + 1}/${recent.length}: ${id}`);
    const detailPaths = [
      ...(args["receipt-detail-url-template"]
        ? [args["receipt-detail-url-template"].replace("{transactionId}", encodeURIComponent(id))]
        : []),
      `/mobile-services/v2/receipts/${encodeURIComponent(id)}`,
      `/mobile-services/v1/receipts/${encodeURIComponent(id)}`,
      `/mobile-services/receipts/v2/${encodeURIComponent(id)}`,
      `/mobile-services/receipts/v1/${encodeURIComponent(id)}`,
      `/receipt/v1/receipts/${encodeURIComponent(id)}`,
    ];
    const detailResult = await requestAny(detailPaths, {
      token: accessToken,
    });
    const detail = detailResult.data;
    detailedReceipts.push({ ...receipt, detail });
  }

  const exportData = {
    source: "ah.nl mobile API",
    fetchedAt: new Date().toISOString(),
    months,
    refreshToken,
    receipts: detailedReceipts,
  };
  await writeJsonFile(out, exportData);
  console.error(`Wrote ${out}`);
  if (refreshToken) {
    console.error("A refresh token is included in the export. Keep it private.");
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
