import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";

import { createTrip, getDbInfo, getTripById, initializeDatabase, listTrips } from "./db.js";

const PORT = Number(process.env.PORT || 3000);
const COZE_PAT = process.env.COZE_PAT;
const COZE_BOT_ID = process.env.COZE_BOT_ID || "7622561335737532470";
const COZE_BASE_URL = "https://api.coze.cn/v3";
const PUBLIC_DIR = join(process.cwd(), "public");

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  });
  res.end(JSON.stringify(data, null, 2));
}

function sendNoContent(res) {
  res.writeHead(204, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  });
  res.end();
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function parseJsonBody(req) {
  const chunks = [];

  for await (const chunk of req) {
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8");

  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw);
  } catch {
    const error = new Error("Request body must be valid JSON");
    error.statusCode = 400;
    throw error;
  }
}

async function callCoze(path, options = {}) {
  if (!COZE_PAT) {
    throw new Error("COZE_PAT is not set");
  }

  const response = await fetch(`${COZE_BASE_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${COZE_PAT}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(`Coze HTTP ${response.status}: ${JSON.stringify(data)}`);
  }

  if (data.code && data.code !== 0) {
    throw new Error(`Coze API error: ${JSON.stringify(data)}`);
  }

  return data;
}

async function createChat(userMessage, userId, conversationId) {
  const payload = {
    bot_id: COZE_BOT_ID,
    user_id: userId,
    stream: false,
    auto_save_history: true,
    additional_messages: [
      {
        role: "user",
        content: userMessage,
        content_type: "text",
      },
    ],
  };

  if (conversationId) {
    payload.conversation_id = conversationId;
  }

  const result = await callCoze("/chat", {
    method: "POST",
    body: JSON.stringify(payload),
  });

  return result.data;
}

async function waitForChat(chatId, conversationId) {
  for (let i = 0; i < 40; i += 1) {
    const result = await callCoze(
      `/chat/retrieve?chat_id=${encodeURIComponent(chatId)}&conversation_id=${encodeURIComponent(conversationId)}`,
      { method: "GET" }
    );

    const status = result?.data?.status;
    console.log(`[coze] poll ${i + 1}: ${status}`);

    if (status === "completed" || status === "requires_action") {
      return result.data;
    }

    if (status === "failed" || status === "cancelled") {
      throw new Error(`Chat task stopped with status: ${status}`);
    }

    await delay(2000);
  }

  throw new Error("Timed out while waiting for Coze response");
}

async function listMessages(chatId, conversationId) {
  const result = await callCoze(
    `/chat/message/list?chat_id=${encodeURIComponent(chatId)}&conversation_id=${encodeURIComponent(conversationId)}`,
    { method: "GET" }
  );

  return result.data || [];
}

function extractAnswer(messages) {
  const answerMessages = messages.filter((item) => item.type === "answer");
  const lastAnswer = answerMessages[answerMessages.length - 1];

  if (!lastAnswer) {
    return "No answer message returned by Coze";
  }

  return typeof lastAnswer.content === "string"
    ? lastAnswer.content
    : JSON.stringify(lastAnswer.content, null, 2);
}

function getTripIdFromPath(pathname) {
  const match = pathname.match(/^\/api\/trips\/(\d+)$/);
  return match ? Number(match[1]) : null;
}

async function serveStatic(res, url) {
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = join(PUBLIC_DIR, pathname);
  const ext = extname(filePath);

  const contentTypes = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
  };

  try {
    const file = await readFile(filePath);
    res.writeHead(200, {
      "Content-Type": contentTypes[ext] || "application/octet-stream",
    });
    res.end(file);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not Found");
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  try {
    if (req.method === "OPTIONS") {
      return sendNoContent(res);
    }

    if (req.method === "GET" && url.pathname === "/api/health") {
      await initializeDatabase();
      return sendJson(res, 200, {
        ok: true,
        database: getDbInfo(),
      });
    }

    if (req.method === "GET" && url.pathname === "/api/trips") {
      const trips = await listTrips();
      return sendJson(res, 200, {
        success: true,
        count: trips.length,
        data: trips,
      });
    }

    if (req.method === "GET") {
      const tripId = getTripIdFromPath(url.pathname);

      if (tripId !== null) {
        const trip = await getTripById(tripId);

        if (!trip) {
          return sendJson(res, 404, {
            success: false,
            error: "Trip not found",
          });
        }

        return sendJson(res, 200, {
          success: true,
          data: trip,
        });
      }
    }

    if (req.method === "POST" && url.pathname === "/api/trips/apply") {
      const body = await parseJsonBody(req);
      const trip = await createTrip(body);

      return sendJson(res, 201, {
        success: true,
        message: "Trip application created",
        data: trip,
      });
    }

    if (req.method === "POST" && url.pathname === "/api/chat") {
      const body = await parseJsonBody(req);
      const userMessage = String(body.message || "").trim();
      const userId = String(body.userId || "demo_user_001");
      const conversationId = String(body.conversationId || "").trim();

      if (!userMessage) {
        return sendJson(res, 400, { error: "message is required" });
      }

      console.log(`[coze] incoming message, userId=${userId}, conversationId=${conversationId || "new"}`);
      const chat = await createChat(userMessage, userId, conversationId);
      console.log(`[coze] created chat, chatId=${chat.id}, conversationId=${chat.conversation_id}`);
      const chatState = await waitForChat(chat.id, chat.conversation_id);
      const messages = await listMessages(chat.id, chat.conversation_id);
      const answer = extractAnswer(messages);

      return sendJson(res, 200, {
        answer,
        status: chatState.status,
        chatId: chat.id,
        conversationId: chat.conversation_id,
      });
    }

    return await serveStatic(res, url);
  } catch (error) {
    const details = Array.isArray(error?.details) ? error.details : undefined;
    const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 500;

    return sendJson(res, statusCode, {
      error: error instanceof Error ? error.message : "Unknown error",
      details,
    });
  }
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`Using bot_id: ${COZE_BOT_ID}`);
  console.log(`Database config: ${JSON.stringify(getDbInfo())}`);
  if (!COZE_PAT) {
    console.log("Warning: COZE_PAT is not set.");
  }
});
