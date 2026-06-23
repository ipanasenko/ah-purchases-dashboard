# AH Purchases Dashboard Skill

Codex skill for fetching Albert Heijn mobile receipt data and generating a local purchase analytics dashboard.

The generated dashboard embeds receipt JSON directly into the HTML output and runs locally in the browser. Keep `ah-auth.json` and generated `outputs/` private.

## Usage

```bash
node scripts/ah-show-dashboard.mjs --months 3 --auth-file ah-auth.json --out-dir outputs --open
```

If no reusable auth file exists, the dashboard script now opens AH login automatically and captures the login code after the user signs in.
