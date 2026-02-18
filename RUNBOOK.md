# Runbook — Video Analyzer Pipeline Incidents

**Pipeline:** S3 (upload) → SQS (`video-analyzer-queue`) → Lambda (`video-analyzer-worker`) → OpenAI → S3 (results)
**Region:** us-east-1
**On-call contact:** _(fill in)_

---

## Quick Reference

| Signal | Likely cause | Jump to |
|--------|-------------|---------|
| DLQ depth > 0 | Lambda crash / timeout | [INC-01](#inc-01--lambda-crash-loop--dlq-build-up) |
| Lambda duration > 800s | OpenAI latency / hang | [INC-02](#inc-02--openai-timeout--lambda-timeout-cascade) |
| No results in S3 after upload | Silent failure in any stage | [INC-03](#inc-03--silent-pipeline-stall-no-result-in-s3) |
| S3 → SQS events missing | S3 notification misconfigured | [INC-04](#inc-04--s3-to-sqs-notification-failure) |
| Chaos env vars still set | Runbook action needed | [Recovery Procedures](#recovery-procedures) |

---

## INC-01 — Lambda Crash Loop / DLQ Build-Up

### Symptoms
- `ApproximateNumberOfMessagesVisible` on `video-analyzer-dlq` > 0
- CloudWatch `AWS/Lambda Errors` for `video-analyzer-worker` spikes
- Users report "still processing" indefinitely
- X-Ray traces show failed segments with exception metadata

### Investigation Steps

```bash
# 1. Check DLQ depth
aws sqs get-queue-attributes \
  --queue-url https://sqs.us-east-1.amazonaws.com/<ACCOUNT_ID>/video-analyzer-dlq \
  --attribute-names ApproximateNumberOfMessages \
  --region us-east-1

# 2. Peek at a DLQ message (do not delete)
aws sqs receive-message \
  --queue-url https://sqs.us-east-1.amazonaws.com/<ACCOUNT_ID>/video-analyzer-dlq \
  --attribute-names All \
  --region us-east-1

# 3. Check Lambda error rate (last 30 min)
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name Errors \
  --dimensions Name=FunctionName,Value=video-analyzer-worker \
  --start-time $(date -u -v-30M +%Y-%m-%dT%H:%M:%SZ) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%SZ) \
  --period 60 --statistics Sum \
  --region us-east-1

# 4. Check Lambda env for chaos flags (remove immediately if present)
aws lambda get-function-configuration \
  --function-name video-analyzer-worker \
  --query 'Environment.Variables' \
  --region us-east-1

# 5. Tail recent Lambda logs
aws logs tail /aws/lambda/video-analyzer-worker --since 30m --region us-east-1

# 6. Search logs for exception text
aws logs filter-log-events \
  --log-group-name /aws/lambda/video-analyzer-worker \
  --filter-pattern "ERROR" \
  --start-time $(date -u -v-30M +%s000) \
  --region us-east-1
```

### Decision Tree

```
DLQ message received?
├─ YES → Inspect message body → is it a real video key?
│         ├─ YES → Lambda is failing on this video (corrupt file, permissions, OOM)
│         │         → See "Root cause by exception type" below
│         └─ NO  → S3 notification is malformed → INC-04
└─ NO  → DLQ alarm false-positive or race; re-check in 5 min
```

### Root Cause by Exception Type

| Exception text | Cause | Fix |
|---|---|---|
| `[CHAOS]` | Chaos test env var not cleaned up | Remove `CHAOS_FAILURE_RATE` env var |
| `ClientError: AccessDenied` | IAM role missing S3 permission | Verify `worker_policy` in Terraform |
| `ClientError: NoSuchKey` | S3 key URL-encoded incorrectly | Check `unquote_plus` in lambda |
| `ValueError: OpenAI API Key is missing` | `OPENAI_API_KEY` env var missing | Re-apply terraform or set manually |
| `MemoryError` / OOM | Video too large for 2048 MB | Increase `memory_size` in lambda.tf |
| `cv2 error` | Corrupt or unsupported video codec | Validate upload on client side |

### Recovery

```bash
# Remove chaos flag if present
CURRENT_ENV=$(aws lambda get-function-configuration \
  --function-name video-analyzer-worker \
  --query 'Environment.Variables' --output json --region us-east-1)

# Remove CHAOS_FAILURE_RATE key and re-apply env
# (use chaos_test.py restore or update manually)
aws lambda update-function-configuration \
  --function-name video-analyzer-worker \
  --environment "Variables={RESULTS_BUCKET_NAME=<RESULTS_BUCKET_NAME>,OPENAI_API_KEY=<key>}" \
  --region us-east-1

# Replay DLQ → main queue (after root cause is fixed)
aws sqs start-message-move-task \
  --source-arn arn:aws:sqs:us-east-1:<ACCOUNT_ID>:video-analyzer-dlq \
  --destination-arn arn:aws:sqs:us-east-1:<ACCOUNT_ID>:video-analyzer-queue \
  --region us-east-1
```

---

## INC-02 — OpenAI Timeout / Lambda Timeout Cascade

### Symptoms
- CloudWatch `Duration` for `video-analyzer-worker` near 900 000ms
- `Throttles` metric non-zero
- X-Ray shows `OpenAI Analysis` subsegment with `chaos_openai_timeout=true` annotation, or no subsegment at all (Lambda killed before it opened)
- DLQ slowly filling (one message per ~2700s = 3 × 900s timeout)
- Users never receive results; no error message

### Investigation Steps

```bash
# 1. Check Lambda duration p99
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name Duration \
  --dimensions Name=FunctionName,Value=video-analyzer-worker \
  --start-time $(date -u -v-60M +%Y-%m-%dT%H:%M:%SZ) \
  --end-time   $(date -u +%Y-%m-%dT%H:%M:%SZ) \
  --period 60 --statistics Maximum \
  --region us-east-1

# 2. Check concurrent executions
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name ConcurrentExecutions \
  --dimensions Name=FunctionName,Value=video-analyzer-worker \
  --start-time $(date -u -v-60M +%Y-%m-%dT%H:%M:%SZ) \
  --end-time   $(date -u +%Y-%m-%dT%H:%M:%SZ) \
  --period 60 --statistics Maximum \
  --region us-east-1

# 3. Verify OpenAI API is reachable (from your machine)
curl -s -o /dev/null -w "%{http_code}" https://api.openai.com/v1/models \
  -H "Authorization: Bearer $OPENAI_API_KEY"

# 4. Check chaos env
aws lambda get-function-configuration \
  --function-name video-analyzer-worker \
  --query 'Environment.Variables.CHAOS_OPENAI_TIMEOUT_SECS' \
  --region us-east-1
```

### Mitigation (OpenAI outage)

```bash
# Option A: Write degraded results (stub analysis) — implement a circuit breaker flag
aws lambda update-function-configuration \
  --function-name video-analyzer-worker \
  --environment "Variables={...existing...,OPENAI_CIRCUIT_BREAK=true}" \
  --region us-east-1
# Lambda should check this flag and write {status: "degraded"} to S3 immediately

# Option B: Pause SQS processing — remove event source mapping
aws lambda update-event-source-mapping \
  --uuid <SQS_EVENT_SOURCE_MAPPING_UUID> \
  --enabled false \
  --region us-east-1
# Re-enable once OpenAI is healthy:
aws lambda update-event-source-mapping \
  --uuid <SQS_EVENT_SOURCE_MAPPING_UUID> \
  --enabled true \
  --region us-east-1
```

### Root Cause Confirmation

X-Ray query to find timeout traces:
1. AWS Console → X-Ray → Traces
2. Filter: `service("video-analyzer-worker") AND fault = true`
3. Look for `OpenAI Analysis` subsegment with no end time (killed mid-execution)

---

## INC-03 — Silent Pipeline Stall (No Result in S3)

### Symptoms
- Video uploaded successfully (200 from `/api/upload`)
- Status API keeps returning `processing`
- No error in browser; no entry in results S3 bucket
- DLQ is empty (no failures visible)

### Investigation Steps

```bash
# 1. Confirm the video exists in S3
aws s3 ls s3://<VIDEO_BUCKET_NAME>/<user-id>/ --region us-east-1

# 2. Check SQS queue depth — is the message stuck in-flight?
aws sqs get-queue-attributes \
  --queue-url https://sqs.us-east-1.amazonaws.com/<ACCOUNT_ID>/video-analyzer-queue \
  --attribute-names ApproximateNumberOfMessages,ApproximateNumberOfMessagesNotVisible \
  --region us-east-1

# 3. Check Lambda invocations (should be > 0 if S3 → SQS → Lambda is working)
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name Invocations \
  --dimensions Name=FunctionName,Value=video-analyzer-worker \
  --start-time $(date -u -v-60M +%Y-%m-%dT%H:%M:%SZ) \
  --end-time   $(date -u +%Y-%m-%dT%H:%M:%SZ) \
  --period 60 --statistics Sum \
  --region us-east-1

# 4. Verify event source mapping is enabled
aws lambda list-event-source-mappings \
  --function-name video-analyzer-worker \
  --region us-east-1 \
  --query 'EventSourceMappings[].{UUID:UUID,State:State,Enabled:Enabled}'

# 5. Verify S3 bucket notification is configured
aws s3api get-bucket-notification-configuration \
  --bucket <VIDEO_BUCKET_NAME> \
  --region us-east-1
```

### Decision Tree

```
Lambda Invocations = 0?
├─ YES → Event source mapping disabled OR S3→SQS notification broken → INC-04
└─ NO  → Lambda is running but not writing result
          ├─ Check logs for exception in S3 Result Write subsegment
          ├─ Verify RESULTS_BUCKET_NAME env var is correct
          └─ Check IAM role has s3:PutObject on results bucket
```

---

## INC-04 — S3 to SQS Notification Failure

### Symptoms
- Upload succeeds
- SQS queue stays empty (no messages, even NotVisible=0)
- Lambda Invocations = 0
- DLQ empty

### Investigation Steps

```bash
# Check S3 notification config
aws s3api get-bucket-notification-configuration \
  --bucket <VIDEO_BUCKET_NAME>

# Check SQS policy allows S3 to send
aws sqs get-queue-attributes \
  --queue-url https://sqs.us-east-1.amazonaws.com/<ACCOUNT_ID>/video-analyzer-queue \
  --attribute-names Policy \
  --region us-east-1

# Re-apply terraform to restore notification config
cd terraform && terraform apply -target=aws_s3_bucket_notification.bucket_notification
```

---

## Recovery Procedures

### Universal restore after chaos test

```bash
# 1. Restore Lambda env (remove all CHAOS_* keys)
aws lambda update-function-configuration \
  --function-name video-analyzer-worker \
  --timeout 900 \
  --environment "Variables={
    RESULTS_BUCKET_NAME=<RESULTS_BUCKET_NAME>,
    OPENAI_API_KEY=<your-key>
  }" \
  --region us-east-1

# 2. Restore SQS visibility timeout
aws sqs set-queue-attributes \
  --queue-url https://sqs.us-east-1.amazonaws.com/<ACCOUNT_ID>/video-analyzer-queue \
  --attributes VisibilityTimeout=910 \
  --region us-east-1

# 3. Drain DLQ (after verifying root cause is fixed)
# Replay to main queue:
aws sqs start-message-move-task \
  --source-arn arn:aws:sqs:us-east-1:<ACCOUNT_ID>:video-analyzer-dlq \
  --destination-arn arn:aws:sqs:us-east-1:<ACCOUNT_ID>:video-analyzer-queue \
  --region us-east-1

# Or purge DLQ if messages are unrecoverable:
aws sqs purge-queue \
  --queue-url https://sqs.us-east-1.amazonaws.com/<ACCOUNT_ID>/video-analyzer-dlq \
  --region us-east-1
```

### Verification after recovery

```bash
# Upload a small synthetic video and watch for result
aws s3 cp /tmp/test.mp4 \
  s3://<VIDEO_BUCKET_NAME>/verify@test.com/verify-$(date +%s).mp4

# Poll results bucket every 10s for up to 5 min
for i in $(seq 30); do
  COUNT=$(aws s3 ls s3://<RESULTS_BUCKET_NAME>/verify@test.com/ 2>/dev/null | wc -l)
  echo "$(date): results count = $COUNT"
  [ "$COUNT" -gt 0 ] && echo "RECOVERED" && break
  sleep 10
done
```

---

## Recommended Alarms (not yet deployed)

Add to `terraform/cloudwatch.tf`:

```hcl
# 1. DLQ depth — critical
resource "aws_cloudwatch_metric_alarm" "dlq_depth" {
  alarm_name          = "video-analyzer-dlq-depth"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "ApproximateNumberOfMessagesVisible"
  namespace           = "AWS/SQS"
  period              = 60
  statistic           = "Maximum"
  threshold           = 0
  alarm_description   = "DLQ has unprocessed messages — pipeline is dropping videos"
  dimensions          = { QueueName = "video-analyzer-dlq" }
  alarm_actions       = [aws_sns_topic.alerts.arn]
}

# 2. Lambda error rate
resource "aws_cloudwatch_metric_alarm" "lambda_errors" {
  alarm_name          = "video-analyzer-lambda-errors"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "Errors"
  namespace           = "AWS/Lambda"
  period              = 60
  statistic           = "Sum"
  threshold           = 2
  dimensions          = { FunctionName = "video-analyzer-worker" }
  alarm_actions       = [aws_sns_topic.alerts.arn]
}

# 3. Lambda duration (OpenAI latency proxy)
resource "aws_cloudwatch_metric_alarm" "lambda_duration" {
  alarm_name          = "video-analyzer-lambda-duration-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "Duration"
  namespace           = "AWS/Lambda"
  period              = 60
  extended_statistic  = "p99"
  threshold           = 800000   # 800s — warn before 900s timeout
  dimensions          = { FunctionName = "video-analyzer-worker" }
  alarm_actions       = [aws_sns_topic.alerts.arn]
}
```

---

## Chaos Test Reference

| Flag | Value | Effect |
|------|-------|--------|
| `CHAOS_FAILURE_RATE` | `0.5` | ~50% of invocations raise RuntimeError immediately |
| `CHAOS_OPENAI_TIMEOUT_SECS` | `60` | Lambda sleeps 60s before calling OpenAI (use with short Lambda timeout) |

Run the test suite:
```bash
# Full suite (~10 min with default CHAOS_VISIBILITY_TIMEOUT=30s)
python chaos_test.py

# Skip baseline + timeout phase for a quick failure-rate-only test (~5 min)
python chaos_test.py --skip-baseline --skip-timeout

# Dry run — print plan, no AWS mutations
python chaos_test.py --dry-run
```

> **Safety:** `chaos_test.py` always restores Lambda env vars, timeout, and SQS visibility in a `finally` block — even if interrupted with Ctrl-C.
