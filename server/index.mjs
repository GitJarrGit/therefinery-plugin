#!/usr/bin/env node
/**
 * therefinery MCP server (stdio, zero dependencies, Node >= 18).
 *
 * Talks to therefinery.com's web API the same way the browser app does:
 * logs in via POST /api/login (username + password), keeps the session
 * cookie, and exposes generation / board / credit / share tools.
 *
 * Credentials (checked in this order):
 *   1. env THEREFINERY_EMAIL / THEREFINERY_PASSWORD
 *   2. ~/.config/therefinery/credentials.json  -> { "email": "...", "password": "..." }
 *
 * Optional: THEREFINERY_URL (default https://therefinery.com)
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import process from "node:process";

const BASE = (process.env.THEREFINERY_URL || "https://therefinery.com").replace(/\/+$/, "");
const SERVER_INFO = { name: "therefinery", version: "0.1.0" };

// ---------------------------------------------------------------------------
// Model registry snapshot (mirrors lib/models.ts on the site). If the site
// adds models, update this list — generation still works for unknown ids
// because the server passes modelId through, but labels/ratios help Claude.
// ---------------------------------------------------------------------------
const MODELS = [
  { id: "nano-banana-2", label: "Nano Banana 2 (Google)", kind: "image", aspectRatios: ["1:1","16:9","9:16","4:3","3:4"], resolutions: ["1K","2K","4K"], refs: true },
  { id: "nano-banana", label: "Nano Banana (Google)", kind: "image", aspectRatios: ["1:1","16:9","9:16","4:3","3:4"], refs: true },
  { id: "seedream-4-5", label: "Seedream 4.5 (photoreal)", kind: "image", aspectRatios: ["1:1","16:9","9:16","4:3","3:4","2:3","3:2","21:9"], resolutions: ["2K","4K"], refs: true },
  { id: "seedream-5-lite", label: "Seedream 5 Lite", kind: "image", aspectRatios: ["1:1","16:9","9:16","4:3","3:4","2:3","3:2","21:9"], resolutions: ["2K","4K"], refs: true },
  { id: "imagen4", label: "Google Imagen 4", kind: "image", aspectRatios: ["1:1","16:9","9:16","4:3","3:4"], refs: false },
  { id: "gpt-image-2", label: "GPT Image 2 (OpenAI)", kind: "image", aspectRatios: ["1:1","16:9","9:16","4:3","3:4","3:2","2:3","21:9"], resolutions: ["1K","2K","4K"], refs: true },
  { id: "topaz-upscale", label: "Topaz Upscale", kind: "image", aspectRatios: ["1:1"], resolutions: ["2×","4×","8×"], refs: true, requiresReference: true, promptless: true },
  { id: "seedance-2", label: "Seedance 2.0 (Video)", kind: "video", aspectRatios: ["16:9","9:16","1:1","4:3","3:4"], resolutions: ["480p","720p","1080p"], durations: [5,10], refs: true },
  { id: "seedance-2-fast", label: "Seedance 2.0 Fast (Video)", kind: "video", aspectRatios: ["16:9","9:16","1:1","4:3","3:4"], resolutions: ["480p","720p","1080p"], durations: [5,10], refs: true },
  { id: "kling-3", label: "Kling 3.0 (Video)", kind: "video", aspectRatios: ["16:9","9:16","1:1"], resolutions: ["720p","1080p","4K"], durations: [5,10], refs: true },
  { id: "grok-imagine-1-5", label: "Grok Imagine 1.5 (Video)", kind: "video", aspectRatios: ["16:9","9:16","1:1","2:3","3:2"], resolutions: ["480p","720p"], durations: [6], refs: true },
  { id: "veo-3-1-fast", label: "Veo 3.1 Fast (Video)", kind: "video", aspectRatios: ["16:9","9:16"], refs: true },
  { id: "veo-3-1", label: "Veo 3.1 (Video)", kind: "video", aspectRatios: ["16:9","9:16"], refs: true },
];

// ---------------------------------------------------------------------------
// Auth + HTTP
// ---------------------------------------------------------------------------
function credentials() {
  const email = process.env.THEREFINERY_EMAIL;
  const password = process.env.THEREFINERY_PASSWORD;
  if (email && password) return { email, password };
  const file = path.join(os.homedir(), ".config", "therefinery", "credentials.json");
  try {
    const j = JSON.parse(fs.readFileSync(file, "utf8"));
    if (j.email && j.password) return { email: j.email, password: j.password };
  } catch {
    /* fall through */
  }
  throw new Error(
    `No credentials. Set THEREFINERY_EMAIL + THEREFINERY_PASSWORD env vars, or create ${file} with {"email":"...","password":"..."}`
  );
}

let sessionCookie = null;

async function login() {
  const { email, password } = credentials();
  const res = await fetch(`${BASE}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: email, password }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Login failed (HTTP ${res.status})`);
  const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get("set-cookie")].filter(Boolean);
  sessionCookie = setCookies.map((c) => c.split(";")[0]).join("; ");
  if (!sessionCookie) throw new Error("Login succeeded but no session cookie returned");
  return json.user;
}

/** Authenticated fetch with one automatic re-login on 401. */
async function apiFetch(method, p, body, retried = false) {
  if (!sessionCookie) await login();
  const res = await fetch(`${BASE}${p}`, {
    method,
    headers: {
      Cookie: sessionCookie,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && !retried) {
    sessionCookie = null;
    return apiFetch(method, p, body, true);
  }
  return res;
}

async function apiJson(method, p, body) {
  const res = await apiFetch(method, p, body);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `${method} ${p} failed (HTTP ${res.status})`);
  return json;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function ratioToHeight(aspect, width) {
  const [w, h] = String(aspect || "1:1").split(":").map(Number);
  if (!w || !h) return width;
  return Math.round((width * h) / w);
}

async function defaultBoardId() {
  const { boards } = await apiJson("GET", "/api/boards");
  if (!boards?.length) throw new Error("No boards on this account");
  return boards[0].id;
}

function text(s) {
  return { content: [{ type: "text", text: typeof s === "string" ? s : JSON.stringify(s, null, 2) }] };
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------
const TOOLS = [
  {
    name: "refinery_models",
    description:
      "List the AI models available on therefinery.com (ids, image/video kind, aspect ratios, resolutions, video durations, reference-image support). Call this before refinery_generate if unsure of a model id.",
    annotations: { title: "List models", readOnlyHint: true },
    inputSchema: { type: "object", properties: {} },
    handler: async () => text(MODELS),
  },
  {
    name: "refinery_account",
    description: "Show the logged-in therefinery.com account: email and current credit balance (1 credit = 1¢).",
    annotations: { title: "Check account & credits", readOnlyHint: true },
    inputSchema: { type: "object", properties: {} },
    handler: async () => {
      const { user } = await apiJson("GET", "/api/me");
      return text(user);
    },
  },
  {
    name: "refinery_boards",
    description: "List the user's boards on therefinery.com (id, name, createdAt).",
    annotations: { title: "List boards", readOnlyHint: true },
    inputSchema: { type: "object", properties: {} },
    handler: async () => {
      const { boards } = await apiJson("GET", "/api/boards");
      return text(boards);
    },
  },
  {
    name: "refinery_create_board",
    description: "Create a new board on therefinery.com.",
    annotations: { title: "Create board", readOnlyHint: false, destructiveHint: false },
    inputSchema: {
      type: "object",
      properties: { name: { type: "string", description: "Board name" } },
      required: ["name"],
    },
    handler: async ({ name }) => {
      const { board } = await apiJson("POST", "/api/boards", { name });
      return text(board);
    },
  },
  {
    name: "refinery_board_items",
    description:
      "List the items (generated images/videos) on a board: id, prompt, model, video flag, createdAt. Use the item id with refinery_download or refinery_share.",
    annotations: { title: "List board items", readOnlyHint: true },
    inputSchema: {
      type: "object",
      properties: { boardId: { type: "string", description: "Board id (from refinery_boards). Omit to use the first board." } },
    },
    handler: async ({ boardId }) => {
      const bid = boardId || (await defaultBoardId());
      const { items } = await apiJson("GET", `/api/board?boardId=${encodeURIComponent(bid)}`);
      const slim = (items || []).map((it) => ({
        id: it.id,
        prompt: it.prompt,
        model: it.modelLabel,
        video: !!it.video,
        fav: !!it.fav,
        createdAt: it.createdAt,
      }));
      return text({ boardId: bid, count: slim.length, items: slim });
    },
  },
  {
    name: "refinery_generate",
    description:
      "Generate an image or video on therefinery.com and save it to a board. Charges account credits. Polls until the result is ready (videos can take several minutes). Returns the new item id, credits charged, and remaining balance. Use refinery_models for valid modelId / aspectRatio / resolution / durationSec values.",
    annotations: { title: "Generate image/video (spends credits)", readOnlyHint: false, destructiveHint: true },
    inputSchema: {
      type: "object",
      properties: {
        modelId: { type: "string", description: "Model id, e.g. nano-banana-2, seedream-4-5, kling-3" },
        prompt: { type: "string", description: "Generation prompt (optional only for promptless models like topaz-upscale)" },
        aspectRatio: { type: "string", description: "e.g. 16:9 (defaults to the model's first ratio)" },
        resolution: { type: "string", description: "e.g. 2K / 1080p (defaults to the model's first resolution)" },
        durationSec: { type: "number", description: "Video duration in seconds (video models only)" },
        referenceUrls: { type: "array", items: { type: "string" }, description: "Public image URLs used as reference / first+last frame / image-to-edit" },
        boardId: { type: "string", description: "Board to save to (default: first board)" },
        timeoutSec: { type: "number", description: "Max seconds to wait for the result (default 480)" },
      },
      required: ["modelId"],
    },
    handler: async (a) => {
      const model = MODELS.find((m) => m.id === a.modelId);
      const gen = await apiJson("POST", "/api/generate", {
        modelId: a.modelId,
        prompt: a.prompt ?? "",
        aspectRatio: a.aspectRatio,
        resolution: a.resolution,
        durationSec: a.durationSec,
        referenceUrls: a.referenceUrls,
      });
      const { taskId, provider, cost, credits } = gen;

      const deadline = Date.now() + (Number(a.timeoutSec) || 480) * 1000;
      let resultUrl = "";
      while (Date.now() < deadline) {
        await sleep(3000);
        const st = await apiJson(
          "GET",
          `/api/task/${encodeURIComponent(taskId)}` + (provider ? `?provider=${encodeURIComponent(provider)}` : "")
        );
        if (st.state === "success") {
          resultUrl = st.resultUrls?.[0] ?? "";
          if (!resultUrl) throw new Error("Task succeeded but returned no result URL");
          break;
        }
        if (st.state === "fail") throw new Error(st.failMsg || "Generation failed");
      }
      if (!resultUrl) {
        return text({
          status: "still-running",
          note: `Timed out after ${a.timeoutSec || 480}s but the task is still running and credits were charged. Poll with refinery_task_status, then save with refinery_save_result.`,
          taskId,
          provider: provider || null,
          cost,
          creditsRemaining: credits,
        });
      }

      const boardId = a.boardId || (await defaultBoardId());
      const aspect = a.aspectRatio || model?.aspectRatios?.[0] || "1:1";
      const w = 300;
      const item = {
        id: crypto.randomUUID(),
        x: 80 + Math.floor(Math.random() * 500),
        y: 80 + Math.floor(Math.random() * 400),
        w,
        h: ratioToHeight(aspect, w),
        prompt: a.prompt ?? "",
        modelLabel: model?.label || a.modelId,
        ...(model?.kind === "video" ? { video: true } : {}),
        createdAt: Date.now(),
      };
      await apiJson("POST", "/api/save", { boardId, item, url: resultUrl });

      return text({
        status: "saved",
        itemId: item.id,
        boardId,
        model: item.modelLabel,
        video: !!item.video,
        creditsCharged: cost,
        creditsRemaining: credits,
        viewInApp: `${BASE}/app`,
        tip: "Use refinery_share to mint a public link, or refinery_download to save the file locally.",
      });
    },
  },
  {
    name: "refinery_task_status",
    description: "Check a generation task started by refinery_generate that timed out (state: waiting/generating/success/fail + result URLs).",
    annotations: { title: "Check generation status", readOnlyHint: true },
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string" },
        provider: { type: "string", description: "Pass 'veo' for Veo tasks (as returned by refinery_generate)" },
      },
      required: ["taskId"],
    },
    handler: async ({ taskId, provider }) =>
      text(await apiJson("GET", `/api/task/${encodeURIComponent(taskId)}` + (provider ? `?provider=${encodeURIComponent(provider)}` : ""))),
  },
  {
    name: "refinery_save_result",
    description:
      "Save a finished generation to a board (use after refinery_task_status shows success for a task that timed out in refinery_generate).",
    annotations: { title: "Save result to board", readOnlyHint: false, destructiveHint: false },
    inputSchema: {
      type: "object",
      properties: {
        resultUrl: { type: "string", description: "A result URL from refinery_task_status" },
        prompt: { type: "string" },
        modelId: { type: "string" },
        aspectRatio: { type: "string" },
        boardId: { type: "string" },
      },
      required: ["resultUrl", "modelId"],
    },
    handler: async (a) => {
      const model = MODELS.find((m) => m.id === a.modelId);
      const boardId = a.boardId || (await defaultBoardId());
      const w = 300;
      const item = {
        id: crypto.randomUUID(),
        x: 80 + Math.floor(Math.random() * 500),
        y: 80 + Math.floor(Math.random() * 400),
        w,
        h: ratioToHeight(a.aspectRatio || model?.aspectRatios?.[0] || "1:1", w),
        prompt: a.prompt ?? "",
        modelLabel: model?.label || a.modelId,
        ...(model?.kind === "video" ? { video: true } : {}),
        createdAt: Date.now(),
      };
      await apiJson("POST", "/api/save", { boardId, item, url: a.resultUrl });
      return text({ status: "saved", itemId: item.id, boardId });
    },
  },
  {
    name: "refinery_share",
    description: "Create a public read-only share link (https://therefinery.com/s/...) for a board item or a whole board. Anyone with the link can view the content.",
    annotations: { title: "Create public share link", readOnlyHint: false, destructiveHint: true },
    inputSchema: {
      type: "object",
      properties: {
        itemId: { type: "string", description: "Item id to share" },
        boardId: { type: "string", description: "OR a board id to share the whole board" },
      },
    },
    handler: async ({ itemId, boardId }) => {
      if (!itemId && !boardId) throw new Error("Provide itemId or boardId");
      const { url } = await apiJson("POST", "/api/share", itemId ? { itemId } : { boardId });
      return text({ shareUrl: `${BASE}${url}` });
    },
  },
  {
    name: "refinery_download",
    description: "Download a board item's image or video file to a local path on this computer.",
    annotations: { title: "Download to local file", readOnlyHint: false, destructiveHint: false },
    inputSchema: {
      type: "object",
      properties: {
        itemId: { type: "string", description: "Item id (from refinery_board_items or refinery_generate)" },
        outputPath: { type: "string", description: "Absolute local file path to write, e.g. /Users/me/Desktop/pic.png (extension: .png for images, .mp4 for videos)" },
      },
      required: ["itemId", "outputPath"],
    },
    handler: async ({ itemId, outputPath }) => {
      const res = await apiFetch("GET", `/api/image/${encodeURIComponent(itemId)}`);
      if (!res.ok) throw new Error(`Download failed (HTTP ${res.status})`);
      const buf = Buffer.from(await res.arrayBuffer());
      const out = path.resolve(outputPath);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, buf);
      return text({ saved: out, bytes: buf.length, contentType: res.headers.get("content-type") });
    },
  },
];

// ---------------------------------------------------------------------------
// Minimal MCP stdio transport (newline-delimited JSON-RPC 2.0)
// ---------------------------------------------------------------------------
function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

async function handle(req) {
  const { id, method, params } = req;
  const respond = (result) => id !== undefined && send({ jsonrpc: "2.0", id, result });
  const fail = (code, message) => id !== undefined && send({ jsonrpc: "2.0", id, error: { code, message } });

  try {
    switch (method) {
      case "initialize":
        respond({
          protocolVersion: params?.protocolVersion || "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
        });
        break;
      case "notifications/initialized":
      case "notifications/cancelled":
        break; // notifications: no response
      case "ping":
        respond({});
        break;
      case "tools/list":
        respond({
          tools: TOOLS.map(({ name, description, inputSchema, annotations }) => ({
            name,
            description,
            inputSchema,
            ...(annotations ? { annotations } : {}),
          })),
        });
        break;
      case "tools/call": {
        const tool = TOOLS.find((t) => t.name === params?.name);
        if (!tool) return fail(-32602, `Unknown tool: ${params?.name}`);
        try {
          respond(await tool.handler(params?.arguments ?? {}));
        } catch (err) {
          respond({ content: [{ type: "text", text: `Error: ${err?.message || err}` }], isError: true });
        }
        break;
      }
      default:
        if (id !== undefined) fail(-32601, `Method not found: ${method}`);
    }
  } catch (err) {
    fail(-32603, err?.message || "Internal error");
  }
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let nl;
  while ((nl = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (!line) continue;
    try {
      handle(JSON.parse(line));
    } catch {
      /* ignore malformed lines */
    }
  }
});
process.stdin.on("end", () => process.exit(0));
