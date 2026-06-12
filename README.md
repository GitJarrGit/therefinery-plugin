# therefinery plugin

Use [therefinery.com](https://therefinery.com) — the AI image & video canvas — straight from Claude and Claude Cowork.

## What it does

The bundled MCP server logs into your therefinery account and exposes these tools:

| Tool | Purpose |
|------|---------|
| `refinery_models` | List the 20 available models (image + video) with valid options |
| `refinery_generate` | Generate an image/video and save it to a board (charges credits) |
| `refinery_task_status` / `refinery_save_result` | Recover long-running generations that outlived the wait |
| `refinery_boards` / `refinery_create_board` | List or create boards |
| `refinery_board_items` | List the images/videos on a board |
| `refinery_download` | Save an item's file to your computer |
| `refinery_share` | Mint a public `therefinery.com/s/...` link for an item or board |
| `refinery_account` | Check your credit balance |

## Setup

Requires Node.js 18+ on your machine.

Give the server your therefinery login **once**, either way:

**Option A — config file (recommended):**

```bash
mkdir -p ~/.config/therefinery
cat > ~/.config/therefinery/credentials.json <<'EOF'
{ "email": "you@example.com", "password": "your-password" }
EOF
chmod 600 ~/.config/therefinery/credentials.json
```

**Option B — environment variables:** set `THEREFINERY_EMAIL` and `THEREFINERY_PASSWORD` where Claude runs.

Optional: `THEREFINERY_URL` to point at a different instance (default `https://therefinery.com`).

## Example asks

- "Generate a 16:9 Seedream 4.5 image of a brutalist greenhouse at dawn and give me a share link"
- "How many credits do I have left on the refinery?"
- "List what's on my main board and download the latest video to my Desktop"

## Notes

- Generation **spends real credits** (1 credit = 1¢) — Claude will see cost and remaining balance in the tool result.
- Video generations can take several minutes; the generate tool waits up to 8 minutes by default, then hands you a task id to poll.
- The session cookie lives only in the server process memory; credentials are read from your config file/env and sent only to therefinery.com.
- therefinery.com requires users to be **18+** and resident in the **United States, Canada, or Australia** — see the [Terms](https://therefinery.com/terms).

## Privacy Policy

This plugin runs entirely on your machine and communicates only with therefinery.com:

- **Data sent:** your therefinery login (read from `~/.config/therefinery/credentials.json` or env vars), your prompts, reference image URLs, and generation settings. Nothing is sent to any other server.
- **Data stored locally:** files you explicitly download via `refinery_download`. The session cookie is held in process memory only and discarded when the server stops.
- **No telemetry:** the plugin collects no analytics and shares nothing with third parties.
- How therefinery.com itself handles your data is described in its privacy policy: https://therefinery.com/privacy — including processing of prompts through third-party AI model providers, data retention, and deletion requests (support@therefinery.com).

## License

MIT — see [LICENSE](LICENSE).
