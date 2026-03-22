type PersistJob = {
  id: string;
  label: string;
  requestId: string;
  attempt: number;
  nextRunAt: number;
  run: () => Promise<void>;
};

const queue: PersistJob[] = [];
const RETRY_DELAYS_MS = [5000, 15000, 45000];
let timer: ReturnType<typeof setInterval> | null = null;

function ensureTimer(): void {
  if (timer) return;
  timer = setInterval(() => {
    void processQueue();
  }, 2000);
  if (typeof (timer as any)?.unref === "function") {
    (timer as any).unref();
  }
}

async function processQueue(): Promise<void> {
  if (!queue.length) return;
  const now = Date.now();
  for (let i = 0; i < queue.length; i++) {
    const job = queue[i];
    if (job.nextRunAt > now) continue;
    try {
      await job.run();
      queue.splice(i, 1);
      i--;
      console.log(`[persist-retry] success label=${job.label} requestId=${job.requestId} attempt=${job.attempt}`);
    } catch (err: any) {
      const nextAttempt = job.attempt + 1;
      if (nextAttempt > RETRY_DELAYS_MS.length + 1) {
        console.error(
          `[persist-retry] drop label=${job.label} requestId=${job.requestId} attempts=${job.attempt} error=${err?.message || "unknown"}`,
        );
        queue.splice(i, 1);
        i--;
        continue;
      }
      job.attempt = nextAttempt;
      job.nextRunAt = Date.now() + RETRY_DELAYS_MS[nextAttempt - 2];
      console.error(
        `[persist-retry] retry-scheduled label=${job.label} requestId=${job.requestId} attempt=${job.attempt} nextInMs=${RETRY_DELAYS_MS[nextAttempt - 2]} error=${err?.message || "unknown"}`,
      );
    }
  }
}

export function enqueuePersistRetry(
  label: string,
  requestId: string,
  run: () => Promise<void>,
): void {
  queue.push({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    label,
    requestId,
    attempt: 1,
    nextRunAt: Date.now() + RETRY_DELAYS_MS[0],
    run,
  });
  ensureTimer();
  console.error(`[persist-retry] queued label=${label} requestId=${requestId}`);
}

