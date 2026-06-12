---
name: therefinery
description: Generate AI images and video on therefinery.com, browse boards, download results, mint share links, and check credits. Use when the user mentions therefinery, the refinery, their image board, refinery credits, or asks to generate images/video "on my site".
---

# Using therefinery from Claude

therefinery.com is the user's AI image & video canvas. The `therefinery` MCP server (bundled with this plugin) is already authenticated with their account.

## Workflow

1. **Pick a model.** Call `refinery_models` if unsure. Image models: nano-banana-2, nano-banana, seedream-4-5 (photoreal default), seedream-5-lite, imagen4, gpt-image-2, topaz-upscale (upscaler, needs a reference, no prompt). Video models: seedance-2, seedance-2-fast, kling-3, grok-imagine-1-5, veo-3-1, veo-3-1-fast.
2. **Generate** with `refinery_generate`. Pass only options the model supports (check `refinery_models` output). Reference images must be public URLs; video models use refs as first frame + optional last frame.
3. The result is saved to a board automatically (first board unless `boardId` given). Offer the user a share link (`refinery_share`) or a local download (`refinery_download`).

## Rules

- Generation charges real credits (1 credit = 1¢). State the cost and remaining balance from the tool result after generating. If a generation would be expensive (videos, 4K), confirm with the user first.
- If `refinery_generate` returns `still-running`, poll `refinery_task_status` (pass `provider` if it was returned), then call `refinery_save_result` once successful — credits were already charged, so never re-generate.
- A 402 error means not enough credits — tell the user and point them to therefinery.com/pricing; do not retry.
- Default board placement is automatic; don't ask the user about x/y positions.
- For "show me what's on my board", use `refinery_board_items` and summarize prompts + models; share links are the best way to let the user view a specific item.
