import { Counter, Histogram, Registry, collectDefaultMetrics } from "prom-client";

// ── Global singleton cache ─────────────────────────────────────────────────
// Next.js HMR re-executes modules on every hot reload. Without this cache,
// prom-client throws "metric already registered" on the second evaluation.
// Storing everything on `global` survives module re-evaluation.
type MetricStore = {
  registry: Registry;
  httpRequestsTotal: Counter<string>;
  httpRequestDurationSeconds: Histogram<string>;
  uploadsTotal: Counter<string>;
  uploadFileSizeBytes: Histogram<string>;
  processingPollsTotal: Counter<string>;
};

const g = global as typeof globalThis & { __metrics?: MetricStore };

function buildMetrics(): MetricStore {
  const registry = new Registry();
  collectDefaultMetrics({ register: registry });

  return {
    registry,

    // ── HTTP request metrics ────────────────────────────────────────────
    httpRequestsTotal: new Counter({
      name: "http_requests_total",
      help: "Total number of HTTP requests",
      labelNames: ["method", "route", "status_code"],
      registers: [registry],
    }),

    httpRequestDurationSeconds: new Histogram({
      name: "http_request_duration_seconds",
      help: "HTTP request latency in seconds",
      labelNames: ["method", "route", "status_code"],
      buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
      registers: [registry],
    }),

    // ── Upload pipeline metrics ─────────────────────────────────────────
    uploadsTotal: new Counter({
      name: "video_uploads_total",
      help: "Total upload requests by outcome",
      labelNames: ["outcome"], // success | error | cached
      registers: [registry],
    }),

    uploadFileSizeBytes: new Histogram({
      name: "video_upload_file_size_bytes",
      help: "Size of uploaded files in bytes",
      buckets: [
        1_000_000,   // 1 MB
        5_000_000,   // 5 MB
        10_000_000,  // 10 MB
        25_000_000,  // 25 MB
        50_000_000,  // 50 MB
        100_000_000, // 100 MB
        200_000_000, // 200 MB
      ],
      registers: [registry],
    }),

    // ── Processing / polling metrics ────────────────────────────────────
    processingPollsTotal: new Counter({
      name: "video_processing_polls_total",
      help: "Status polling requests by result",
      labelNames: ["result"], // completed | processing | failed
      registers: [registry],
    }),
  };
}

// Only build once per process — survive HMR reloads
if (!g.__metrics) {
  g.__metrics = buildMetrics();
}

const m = g.__metrics;

export const register                   = m.registry;
export const httpRequestsTotal          = m.httpRequestsTotal;
export const httpRequestDurationSeconds = m.httpRequestDurationSeconds;
export const uploadsTotal               = m.uploadsTotal;
export const uploadFileSizeBytes        = m.uploadFileSizeBytes;
export const processingPollsTotal       = m.processingPollsTotal;
