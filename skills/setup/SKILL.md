---
name: therefinery-setup
description: First-time setup for the therefinery plugin — configure credentials and verify the connection. Use when the user just installed the therefinery plugin, when refinery tools fail with "No credentials", or when the user asks to set up, configure, or connect therefinery.
---

# Setting up the therefinery plugin

The bundled MCP server needs the user's own therefinery.com login before any `refinery_*` tool works.

## Steps

1. **Check for an account.** Ask whether the user has a therefinery.com account. If not, send them to https://therefinery.com/login (Create account). Note: the service requires users to be 18+ and resident in the United States or Canada. New accounts include free starter credits.

2. **Create the credentials file.** Do NOT ask the user to paste their password into chat. Instead, instruct them to run this in their own terminal, replacing the placeholders:

   ```bash
   mkdir -p ~/.config/therefinery
   cat > ~/.config/therefinery/credentials.json <<'EOF'
   { "email": "YOUR_EMAIL", "password": "YOUR_PASSWORD" }
   EOF
   chmod 600 ~/.config/therefinery/credentials.json
   ```

   Alternative: they may set `THEREFINERY_EMAIL` and `THEREFINERY_PASSWORD` environment variables instead (env vars win over the file).

3. **Verify.** Call `refinery_account`. Success returns their email and credit balance — report the balance. A credentials error means the file is missing or malformed (it must be valid JSON with exactly `email` and `password` keys); a "Wrong username or password" error means the login itself is wrong.

4. **Requirements.** Node.js 18+ must be installed (`node --version`). If Node is missing, point them to https://nodejs.org.

## After setup

Suggest a first try: a cheap image generation (e.g. Seedream 4.5 or Nano Banana, ~6–10 credits) so they see the full generate → board → share-link flow. Mention that generations spend real credits (1 credit = 1¢).
