/**
 * PulseList → Notion sync proxy (Cloudflare Worker)
 *
 * SETUP
 * ─────
 * 1. Go to https://www.notion.so/my-integrations and create an integration.
 *    Copy the "Internal Integration Token" — that's your NOTION_TOKEN.
 *
 * 2. In Notion, create a database with these properties:
 *      Name        Title
 *      Due Date    Date
 *      Category    Select
 *      Priority    Select
 *      Done        Checkbox
 *    Open the database, click Share → Invite your integration.
 *    Copy the database ID from the URL:
 *      https://www.notion.so/<workspace>/<DATABASE_ID>?v=...
 *
 * 3. Deploy this file to Cloudflare Workers (workers.cloudflare.com — free tier).
 *    In the Worker's Settings → Variables, add:
 *      NOTION_TOKEN        = secret_xxxxxxxxxxxxx
 *      NOTION_DATABASE_ID  = xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
 *
 * 4. In PulseList Settings → Notion, paste your Worker URL and click Connect.
 *
 * ENDPOINTS (called by pulselist-app.js)
 * ──────────────────────────────────────
 *   GET  /ping            — health check
 *   POST /task            — create a Notion page for a task
 *   PATCH /task/:pageId   — update an existing page
 *   DELETE /task/:pageId  — archive a page
 */

const NOTION_API     = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS });
    }

    const url   = new URL(request.url);
    const path  = url.pathname.replace(/\/$/, "");

    try {
      if (path === "/ping") {
        return json({ ok: true });
      }

      if (path === "/task" && request.method === "POST") {
        const task = await request.json();
        const page = await notionFetch(env, "POST", "/pages", buildPage(env, task));
        return json({ id: page.id });
      }

      const match = path.match(/^\/task\/([a-f0-9-]+)$/i);
      if (match) {
        const pageId = match[1];

        if (request.method === "PATCH") {
          const task = await request.json();
          await notionFetch(env, "PATCH", `/pages/${pageId}`, { properties: buildProperties(task) });
          return json({ ok: true });
        }

        if (request.method === "DELETE") {
          await notionFetch(env, "PATCH", `/pages/${pageId}`, { archived: true });
          return json({ ok: true });
        }
      }

      return new Response("Not found", { status: 404, headers: CORS });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), {
        status: 500,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }
  },
};

function buildProperties(task) {
  const props = {
    Name: { title: [{ text: { content: task.title || "Untitled" } }] },
    Done: { checkbox: !!task.done },
  };

  if (task.dueDate) {
    props["Due Date"] = {
      date: { start: task.dueTime ? `${task.dueDate}T${task.dueTime}:00` : task.dueDate },
    };
  }

  if (task.category) {
    props["Category"] = { select: { name: task.category } };
  }

  if (task.priority) {
    props["Priority"] = { select: { name: task.priority } };
  }

  return props;
}

function buildPage(env, task) {
  const page = {
    parent:     { database_id: env.NOTION_DATABASE_ID },
    properties: buildProperties(task),
  };

  if (task.description) {
    page.children = [{
      object: "block",
      type:   "paragraph",
      paragraph: {
        rich_text: [{ type: "text", text: { content: task.description } }],
      },
    }];
  }

  return page;
}

async function notionFetch(env, method, path, body) {
  const res = await fetch(`${NOTION_API}${path}`, {
    method,
    headers: {
      "Authorization":   `Bearer ${env.NOTION_TOKEN}`,
      "Content-Type":    "application/json",
      "Notion-Version":  NOTION_VERSION,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Notion API ${res.status}: ${err}`);
  }

  return res.json();
}

function json(data) {
  return new Response(JSON.stringify(data), {
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
