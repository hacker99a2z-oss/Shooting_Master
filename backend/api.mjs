import { createServer } from "node:http";
import { createHmac } from "node:crypto";
import cloudflareWorker from "./worker/index.ts";
import { createRenderQueue } from "./render-queue.mjs";

const queue = createRenderQueue();
let payoutDrainRunning = false;
let payoutDrainQueued = false;
let maintenanceRunning = false;
let lastMaintenanceAt = 0;
let retryWakeTimer;

async function drainPayoutQueue() {
  if (payoutDrainRunning || process.env.PAYOUT_ENABLED !== "true") return;
  payoutDrainRunning = true;
  let processed = 0;
  try {
    for (; processed < 25; processed += 1) {
      const job = await queue.claimNext();
      if (!job) break;
      let action = "ack";
      const heartbeat = setInterval(() => {
        void queue.renew(job).then((ok) => {
          if (!ok) console.error("[payout] queue lease lost", job.id);
        }).catch((error) => console.error("[payout] queue lease renewal failed", error));
      }, 30_000);
      heartbeat.unref();
      try {
        await cloudflareWorker.queue({
          messages: [{
            body: job.payload,
            ack() { action = "ack"; },
            retry() { action = "retry"; },
          }],
        }, env);
        if (action === "retry") {
          const state = await queue.retry(job, "Temporary blockchain or payout-provider failure");
          console.warn("[payout] retry scheduled", { id: job.id, state });
          if (state === "retry") {
            clearTimeout(retryWakeTimer);
            retryWakeTimer = setTimeout(schedulePayoutDrain, 60_000);
            retryWakeTimer.unref();
          }
        } else {
          await queue.complete(job);
          console.info("[payout] job completed", job.id);
        }
      } catch (error) {
        const state = await queue.retry(job, error instanceof Error ? error.message : String(error));
        console.error("[payout] job attempt failed", { id: job.id, state, error });
        if (state === "retry") {
          clearTimeout(retryWakeTimer);
          retryWakeTimer = setTimeout(schedulePayoutDrain, 60_000);
          retryWakeTimer.unref();
        }
      } finally {
        clearInterval(heartbeat);
      }
    }
  } catch (error) {
    console.error("[payout] queue drain failed", error);
  } finally {
    payoutDrainRunning = false;
    // Continue in bounded batches when more jobs are ready. This avoids leaving
    // jobs stranded after the 25-job safety cap on a single Free Web Service.
    if (processed === 25 && process.env.PAYOUT_ENABLED === "true") {
      clearTimeout(retryWakeTimer);
      retryWakeTimer = setTimeout(schedulePayoutDrain, 1_000);
      retryWakeTimer.unref();
    }
  }
}

function schedulePayoutDrain() {
  if (payoutDrainQueued || process.env.PAYOUT_ENABLED !== "true") return;
  payoutDrainQueued = true;
  setImmediate(() => {
    payoutDrainQueued = false;
    void drainPayoutQueue();
  });
}

async function runMaintenance() {
  if (maintenanceRunning || Date.now() - lastMaintenanceAt < 5 * 60_000) return;
  maintenanceRunning = true;
  lastMaintenanceAt = Date.now();
  const tasks = [];
  try {
    await cloudflareWorker.scheduled({}, env, {
      waitUntil(promise) { tasks.push(Promise.resolve(promise)); },
    });
    await Promise.all(tasks);
    console.info("[scheduler] cleanup and stale payout recovery completed");
  } catch (error) {
    console.error("[scheduler] maintenance failed", error);
  } finally {
    maintenanceRunning = false;
  }
}

const env = {
  ...process.env,
  APP_ORIGIN: process.env.APP_ORIGIN || "https://shooting-master.pages.dev",
  PAYOUT_QUEUE: {
    async send(payload) {
      await queue.send(payload);
      schedulePayoutDrain();
    },
  },
};

async function toWebRequest(request) {
  const host = request.headers.host || "localhost";
  const protocol = request.headers["x-forwarded-proto"] === "https" ? "https" : "http";
  const url = new URL(request.url || "/", protocol + "://" + host);
  const headers = new Headers();
  for (const name of ["accept", "content-type", "origin", "user-agent", "x-telegram-bot-api-secret-token"]) {
    const value = request.headers[name];
    if (typeof value === "string") headers.set(name, value);
  }

  const method = request.method || "GET";
  if (method === "GET" || method === "HEAD") return new Request(url, { method, headers });
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += part.length;
    if (size > 256 * 1024) throw new Error("Request body too large");
    chunks.push(part);
  }
  const body = Buffer.concat(chunks);
  return new Request(url, { method, headers, body: body.length ? body : undefined, duplex: "half" });
}

async function registerTelegramWebhook() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const base = (process.env.PUBLIC_BACKEND_URL || process.env.RENDER_EXTERNAL_URL || "").replace(/\/+$/, "");
  if (!token || !base) {
    console.warn("[telegram] webhook registration skipped; set PUBLIC_BACKEND_URL if Render does not provide RENDER_EXTERNAL_URL");
    return;
  }
  const secret = createHmac("sha256", token)
    .update("shooting-master-telegram-webhook-v1")
    .digest("hex");
  const response = await fetch("https://api.telegram.org/bot" + token + "/setWebhook", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      url: base + "/telegram/webhook",
      secret_token: secret,
      allowed_updates: ["message"],
      drop_pending_updates: false,
    }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok) throw new Error(result.description || "Telegram webhook registration failed");
  console.info("[telegram] webhook registered");
}

async function handle(request, response) {
  try {
    const webRequest = await toWebRequest(request);
    const webResponse = await cloudflareWorker.fetch(webRequest, env, {
      waitUntil(promise) {
        void Promise.resolve(promise).catch((error) => console.error("[api] background task failed", error));
      },
    });
    response.writeHead(webResponse.status, Object.fromEntries(webResponse.headers));
    if (request.method === "HEAD" || webResponse.status === 204 || webResponse.status === 304) {
      response.end();
      return;
    }
    response.end(Buffer.from(await webResponse.arrayBuffer()));
    // Free Render has no Background Worker or Cron service. Run bounded queue and
    // maintenance work only while this single free Web Service is awake on traffic.
    schedulePayoutDrain();
    void runMaintenance();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Request failed";
    const status = message === "Request body too large" ? 413 : 500;
    console.error("[api] request failed", error);
    if (!response.headersSent) {
      response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      response.end(JSON.stringify({ error: status === 413 ? message : "Internal server error" }));
    } else {
      response.destroy();
    }
  }
}

const port = Number(process.env.PORT || 10000);
const server = createServer((request, response) => void handle(request, response));

// Render Free has no separate Background Worker or Cron service. Poll while
// this Web Service is awake; incoming API requests also trigger immediate drains.
// The interval does not keep a sleeping Free instance awake.
const payoutPollTimer = setInterval(schedulePayoutDrain, 15_000);
payoutPollTimer.unref();
server.listen(port, "0.0.0.0", () => {
  console.info("[api] Shooting Master Render Free backend listening on port", port);
  if (process.env.TELEGRAM_WEBHOOK_ENABLED === "true") {
    void registerTelegramWebhook().catch((error) => console.error("[telegram] webhook registration failed", error));
  } else {
    console.info("[telegram] webhook cutover is disabled; the existing webhook is unchanged");
  }
  void runMaintenance();
  schedulePayoutDrain();
});

let closing = false;
async function shutdown(signal) {
  if (closing) return;
  closing = true;
  console.info("[shutdown] received", signal);
  clearInterval(payoutPollTimer);
  clearTimeout(retryWakeTimer);
  server.close(async () => {
    await queue.close().catch((error) => console.error("[shutdown] queue close failed", error));
    process.exit(0);
  });
}
process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
