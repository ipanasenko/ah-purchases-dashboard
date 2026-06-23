---
name: ah-purchases-dashboard
description: Fetch Albert Heijn (AH.nl) mobile receipt data and generate an interactive local purchase analytics dashboard. Use when the user asks to show, refresh, analyze, or create an AH purchases dashboard for the last N months/days, pastes an AH login redirect code/token, or asks about AH receipts, product spend, discounts, categories, or receipt analytics.
---

# AH Purchases Dashboard

Use the bundled scripts to fetch AH mobile receipts and generate a local HTML dashboard with embedded data. Automate the flow as far as possible; only ask the user for login input when no reusable auth file is available.

## Command

Run from the user's current workspace and write user-facing files to `outputs/`:

```bash
node ~/.codex/skills/ah-purchases-dashboard/scripts/ah-show-dashboard.mjs --months 3 --auth-file ah-auth.json --out-dir outputs
```

Change `--months` to the requested month period, or use `--weeks N` for the last N weeks. For "last 30 days", use `--months 1`; the dashboard has a Last 30 days filter.

Do not pass `--open`; the script prints the generated dashboard path and `file://` URL instead of launching a browser. Show that path/link to the user.

## Login Flow

1. If `ah-auth.json` exists in the workspace, run the command immediately. Do not ask for login.
2. If the user already pasted a value containing `code=...`, a UUID-like code, or AH login JSON, run:

```bash
node ~/.codex/skills/ah-purchases-dashboard/scripts/ah-show-dashboard.mjs --months 3 --token 'PASTED_VALUE' --auth-file ah-auth.json --out-dir outputs
```

3. If no auth file or pasted value exists, run the command normally. The script opens AH login automatically, waits for the user to log in, captures the redirect code, and saves `ah-auth.json`.

4. Only if automatic login capture fails, ask the user to open this exact URL, log in, and paste back the redirect/code shown after login:

```text
https://login.ah.nl/secure/oauth/authorize?client_id=appie&redirect_uri=appie%3A%2F%2Flogin-exit&response_type=code
```

Ask for only that pasted redirect/code. Do not ask the user to run commands or inspect network requests.

5. After the user pastes the value, extract nothing manually unless needed; pass the pasted value to `--token`. The script accepts:

- `appie://login-exit?code=...`
- `https://...code=...`
- a bare UUID code
- copied JSON containing a redirect URL

6. Return the generated dashboard path and URL printed by the script. The normal dashboard path is `outputs/ah-purchase-dashboard-with-data.html`.

## Auth And Privacy

- Treat `ah-auth.json` and `outputs/ah-receipts.json` as private.
- Never print access tokens, refresh tokens, full pasted login payloads, or full receipt JSON.
- If token refresh fails, ask for a fresh paste from the login URL and rerun with `--token`.

## Outputs

- `outputs/ah-receipts.json`: fetched raw receipt data.
- `outputs/ah-purchase-dashboard-with-data.html`: interactive dashboard with receipt data embedded directly in the page.

The dashboard shows total spend, receipts, categories, spend over time, product-level before/after discount spend, estimated product discount allocation, and period filters. The generated page does not require JSON import or demo data controls; it initializes from the embedded receipt JSON.

## Notes

- AH's older REST receipt endpoints are stale; the scripts use the mobile GraphQL endpoint.
- Product-level discounts are estimated by allocating receipt-level discounts across product lines that carry AH discount indicators.
- If AH API shape changes, inspect current app/API behavior before changing dashboard logic.
