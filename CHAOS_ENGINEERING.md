# Chaos Engineering Guide

Pipeline under test: **S3 → SQS → Lambda → OpenAI → S3**

---

## Prerequisites

```bash
pip install boto3
brew install ffmpeg          # generates synthetic test videos
aws configure                # needs Lambda, S3, SQS, CloudWatch read/write
```

**Required env vars** — the script reads these instead of hardcoding account-specific values:

```bash
export VIDEO_BUCKET_NAME="$(terraform output -raw video_bucket_name)"
export RESULTS_BUCKET_NAME="$(terraform output -raw results_bucket_name)"
export SQS_QUEUE_URL="$(aws sqs get-queue-url --queue-name video-analyzer-queue --query QueueUrl --output text)"
export SQS_DLQ_URL="$(aws sqs get-queue-url  --queue-name video-analyzer-dlq   --query QueueUrl --output text)"
```

---

## Running the Test

```bash
# Full suite (~15–20 min)
python chaos_test.py

# Skip baseline if pipeline is known-good (~10 min)
python chaos_test.py --skip-baseline

# Skip Phase 2 OpenAI timeout (slowest phase) (~8 min)
python chaos_test.py --skip-baseline --skip-timeout

# Dry run — prints plan, zero AWS mutations
python chaos_test.py --dry-run
```

> **Safety:** a `finally` block always restores Lambda env vars, Lambda timeout,
> and SQS visibility timeout — even on Ctrl-C or crash.
> If you kill the process with SIGKILL, run the manual restore below.

---

## What Each Phase Does

| Phase | Chaos injected | What is measured |
|-------|---------------|-----------------|
| **0 Baseline** | None | End-to-end result latency (healthy pipeline) |
| **1 Failure Rate** | `CHAOS_FAILURE_RATE=1.0` on Lambda | DLQ routing time per message, CloudWatch error detection time |
| **2 OpenAI Timeout** | `CHAOS_OPENAI_TIMEOUT_SECS=60` + Lambda timeout → 30s | DLQ routing time, CloudWatch timeout detection |
| **3 Recovery** | All chaos removed | Time to first successful result after restore |

### Why 1.0 not 0.5 for DLQ measurement?

With `maxReceiveCount=3` and 50% failure rate, only 12.5% of messages reach the DLQ
(the other 87.5% succeed on a retry). The test uses 100% failure rate so DLQ routing
is deterministic and measurable. The 50% scenario is measured separately via
CloudWatch error rate.

---

## Where to Check Results

### 1. Test report (auto-generated)

```
chaos_report_<run_id>.md   ← human-readable findings
chaos_report_<run_id>.json ← raw data
```

### 2. AWS Console — CloudWatch

**Lambda errors and duration**
```
CloudWatch → Metrics → AWS/Lambda
  Function: video-analyzer-worker
  Metrics: Errors, Duration, Throttles, Invocations
```

**DLQ depth**
```
CloudWatch → Metrics → AWS/SQS
  QueueName: video-analyzer-dlq
  Metric: ApproximateNumberOfMessagesVisible
```

### 3. AWS Console — X-Ray

```
X-Ray → Traces
  Filter: service("video-analyzer-worker") AND fault = true
```

Subsegments to look for:
- `Frame Extraction` — CPU phase
- `OpenAI Analysis` — external call (look for `chaos_openai_timeout=true` annotation)
- `S3 Download` / `S3 Result Write` — storage phases

Searchable annotations on every trace:
- `user_id` — uploader email
- `video_id` — S3 object key
- `result_status` — `completed` | `failed`
- `analysis_score` — 0–100

### 4. AWS Console — SQS

```
SQS → video-analyzer-dlq → Send and receive messages → Poll for messages
```

### 5. CloudWatch Logs

```bash
# Live tail
aws logs tail /aws/lambda/video-analyzer-worker --since 30m --region us-east-1

# Filter for chaos events only
aws logs filter-log-events \
  --log-group-name /aws/lambda/video-analyzer-worker \
  --filter-pattern "CHAOS" \
  --region us-east-1
```

---

## Manual Restore

If the test process is killed hard (SIGKILL) before the `finally` block runs:

```bash
# 1. Remove chaos env vars, restore timeout
aws lambda update-function-configuration \
  --function-name video-analyzer-worker \
  --timeout 900 \
  --environment "Variables={
    RESULTS_BUCKET_NAME=$RESULTS_BUCKET_NAME,
    OPENAI_API_KEY=$OPENAI_API_KEY
  }" \
  --region us-east-1

# 2. Restore SQS visibility timeout
aws sqs set-queue-attributes \
  --queue-url "$SQS_QUEUE_URL" \
  --attributes VisibilityTimeout=910 \
  --region us-east-1

# 3. Drain the DLQ
aws sqs purge-queue \
  --queue-url "$SQS_DLQ_URL" \
  --region us-east-1
```

---

## Chaos Env Vars Reference

These are read by `lambda_function.py`. Both default to off when absent.

| Env var | Example value | Effect |
|---------|--------------|--------|
| `CHAOS_FAILURE_RATE` | `1.0` | Fraction of invocations that raise RuntimeError immediately |
| `CHAOS_OPENAI_TIMEOUT_SECS` | `60` | Seconds to sleep before the OpenAI call (triggers Lambda timeout) |

---

## Incident Runbook

See **`RUNBOOK.md`** for per-incident investigation steps, CLI commands,
and recovery procedures for:

- INC-01 Lambda crash loop / DLQ build-up
- INC-02 OpenAI timeout cascade
- INC-03 Silent pipeline stall
- INC-04 S3 → SQS notification failure
