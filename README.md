# AH Purchases Dashboard Skill

Create a local dashboard from your Albert Heijn purchase history.

The dashboard helps you review spending, receipts, categories, product totals, and discounts.

## Install

```bash
npx skills@latest add ipanasenko/ah-purchases-dashboard
```

## Example Usage

Ask your agent:

```text
Use the $ah-purchases-dashboard skill to show my AH purchases dashboard for the last 3 months.
```

Or even shorter:

```text
$ah-purchases-dashboard last 8 weeks.
```

Your agent will generate the dashboard and give you a local link to open.

## Login

The first time you use the skill, your agent will guide you through Albert Heijn login.

Usually, you only need to sign in when prompted. If automatic login does not work, your agent will ask you to paste back the login redirect or code after signing in.

After a successful login, the skill can reuse your saved login for future dashboard refreshes until Albert Heijn asks you to sign in again.

## Privacy

Your Albert Heijn login and receipt data are private. Do not share generated files or pasted login codes unless you intentionally want another tool or person to access that data.
