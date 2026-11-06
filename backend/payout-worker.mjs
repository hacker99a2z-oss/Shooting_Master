import cloudflareWorker from "./worker/index.ts";
import { createRenderQueue } from "./render-queue.mjs";

const queue = createRenderQueue();
const env = {
  ...process.env,
  APP_ORIGIN: process.env.APP_ORIGIN || "https://shooting-master.pages.dev",
  PAYOUT_QUEUE: { send: queue.send },
};

let stopping = false;
let active = false;
let scheduled = false;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function runScheduledTasks() {
  if (scheduled || stopping) return;
  scheduled = true;
  const pending = [];
  try {
    await cloudflareWorker.scheduled({}, env, {
      waitUntil(promise) {
        pending.push(Promise.resolve(promise));
      },
    });
    await Promise.all(pending);
    console.info("[scheduler] cleanup and payout recovery completed");
  } catch (error) {
    console.error("[scheduler] maintenance run failed", error);
  } finally {
    scheduled = false;
  }
}

async function processJob(job) {
  let action = "ack";
  let delaySeconds = 60;
  const heartbeat = setInterval(() => {
    void queue.renew(job).then((ok) => {
      if (!ok) console.error("[payout] queue lease was lost", job.id);
    }).catch((error) => console.error("[payout] queue lease renewal failed", error));
  }, 30_000);
  heartbeat.unref();

  try {
    await cloudflareWorker.queue({
      messages: [{
        body: job.payload,
        ack() {
          action = "ack";
        },
        retry(options = {}) {
          action = "retry";
          delaySeconds = Number(options.delaySeconds || 60);
        },
      }],
    }, env);

    if (action === "retry") {
      const state = await queue.retry(job, "Temporary blockchain or payout-provider failure");
      console.warn("[payout] job scheduled for retry", { id: job.id, state, delaySeconds });
    } else {
      await queue.complete(job);
      console.info("[payout] job acknowledged", job.id);
    }
  } catch (error) {
    const state = await queue.retry(job, error instanceof Error ? error.message : String(error));
    console.error("[payout] processing attempt failed", { id: job.id, state, error });
  } finally {
    clearInterval(heartbeat);
  }
}

async function poll() {
  while (!stopping) {
    if (active) {
      await sleep(1000);
      continue;
    }
    active = true;
    try {
      const job = await queue.claimNext();
      if (job) await processJob(job);
      else await sleep(4000);
    } catch (error) {
      console.error("[payout] queue polling failed", error);
      await sleep(5000);
    } finally {
      active = false;
    }
  }
}

const schedule = setInterval(() => void runScheduledTasks(), 5 * 60_000);
schedule.unref();

async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  clearInterval(schedule);
  console.info("[shutdown] received", signal);
  while (active || scheduled) await sleep(250);
  await queue.close();
  process.exit(0);
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));

await queue.claimNext().then(async (job) => {
  if (job) await processJob(job);
}).catch((error) => console.error("[payout] startup queue check failed", error));

console.info("[worker] Shooting Master Render payout worker started; concurrency=1");
void runScheduledTasks();
await poll();
