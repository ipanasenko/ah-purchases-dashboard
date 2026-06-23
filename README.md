# AH Purchases Dashboard Skill

Codex skill for fetching Albert Heijn mobile receipt data and generating a local purchase analytics dashboard.

The generated dashboard embeds receipt JSON directly into the HTML output and runs locally in the browser. Keep `ah-auth.json` and generated `outputs/` private.

## Usage

```bash
node scripts/ah-show-dashboard.mjs --months 3 --auth-file ah-auth.json --out-dir outputs
```

Use `--weeks N` instead of `--months N` to fetch and build the dashboard for the last N weeks:

```bash
node scripts/ah-show-dashboard.mjs --weeks 8 --auth-file ah-auth.json --out-dir outputs
```

If no reusable auth file exists, the dashboard script now opens AH login automatically and captures the login code after the user signs in.
The script prints the generated dashboard path and `file://` URL; it does not open an external browser automatically.
