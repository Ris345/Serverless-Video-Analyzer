import json
import os
import random
import time
import traceback
import boto3
import cv2
import base64
import uuid
from urllib.parse import unquote_plus
from openai import OpenAI

# ── X-Ray setup ────────────────────────────────────────────────────────────
# patch(['boto3']) must be called BEFORE any boto3 client is created so that
# every subsequent client call is automatically traced as a subsegment.
from aws_xray_sdk.core import xray_recorder, patch
patch(['boto3'])
xray_recorder.configure(
    service='video-analyzer-worker',
    # LOG_ERROR instead of raising so the function keeps running even when
    # the X-Ray daemon is unreachable (e.g. local testing).
    context_missing='LOG_ERROR',
)

# ── Chaos Engineering hooks ────────────────────────────────────────────────
# Controlled exclusively via Lambda env vars set by chaos_test.py.
# Both vars are absent in normal operation — zero runtime cost.
_CHAOS_FAILURE_RATE   = float(os.environ.get('CHAOS_FAILURE_RATE', '0'))    # 0.0–1.0
_CHAOS_OPENAI_SLEEP   = int(os.environ.get('CHAOS_OPENAI_TIMEOUT_SECS', '0'))  # seconds

# ── AWS / OpenAI clients (created after patching) ─────────────────────────
s3_client = boto3.client('s3')

openai_api_key = os.environ.get('OPENAI_API_KEY')
openai_client = OpenAI(api_key=openai_api_key, timeout=800.0) if openai_api_key else None


def process_video_and_analyze(video_path, context_text=""):
    """
    Extracts frames from the video and sends them to OpenAI for analysis.
    Returns the analysis JSON.

    X-Ray subsegments:
      • Frame Extraction — CPU-bound OpenCV work
      • OpenAI Analysis  — external HTTP call (not auto-patched)
    """
    if not openai_client:
        raise ValueError("OpenAI API Key is missing.")

    # ── Subsegment: Frame Extraction ───────────────────────────────────────
    base64Frames = []
    subsegment = xray_recorder.begin_subsegment('Frame Extraction')
    try:
        print(f"Extracting frames from {video_path}...", flush=True)
        video = cv2.VideoCapture(video_path)

        fps          = video.get(cv2.CAP_PROP_FPS)
        total_frames = int(video.get(cv2.CAP_PROP_FRAME_COUNT))
        duration     = total_frames / fps if fps > 0 else 0
        print(f"Video Info: FPS={fps}, Total Frames={total_frames}, Duration={duration}s", flush=True)

        frame_interval = int(fps) if fps > 0 else 30
        frame_count    = 0

        while video.isOpened():
            success, frame = video.read()
            if not success:
                break
            if frame_count % frame_interval == 0:
                _, buffer = cv2.imencode(".jpg", frame)
                base64Frames.append(base64.b64encode(buffer).decode("utf-8"))
            frame_count += 1

        video.release()

        if len(base64Frames) > 20:
            print(f"Resampling frames from {len(base64Frames)} to 20...", flush=True)
            step = len(base64Frames) / 20
            base64Frames = [base64Frames[int(i * step)] for i in range(20)]

        print(f"Extracted {len(base64Frames)} frames.", flush=True)

        subsegment.put_annotation('frame_count', len(base64Frames))
        subsegment.put_metadata('fps',            fps,          namespace='video')
        subsegment.put_metadata('total_frames',   total_frames, namespace='video')
        subsegment.put_metadata('duration_secs',  duration,     namespace='video')
    except Exception as e:
        subsegment.add_exception(e, traceback.extract_stack())
        raise
    finally:
        xray_recorder.end_subsegment()

    if not base64Frames:
        raise ValueError("No frames extracted from video.")

    # Build prompt
    context_instruction = ""
    if context_text:
        try:
            ctx_json = json.loads(context_text)
            history  = ctx_json.get('history', '')
            if history:
                context_instruction = (
                    f"USER CONTEXT / CHAT HISTORY:\n{history}\n\n"
                    "INSTRUCTION: Incorporate the user's focus areas from the context above into your analysis."
                )
        except Exception:
            context_instruction = f"USER CONTEXT: {context_text}"

    PROMPT_MESSAGES = [
        {
            "role": "user",
            "content": [
                {
                    "type": "text",
                    "text": (
                        f"TASK: Technical Video Analysis.\n{context_instruction}\n\n"
                        "OBJECTIVE: Evaluate the technical quality of this video feed across four metrics:\n"
                        "1. Lighting Uniformity: Identify shadow areas or overexposed glare.\n"
                        "2. Focus Sharpness: Evaluate if edges are crisp or if there is motion blur.\n"
                        "3. Frame Composition: Assess the alignment and positioning of the primary subject.\n"
                        "4. Color Accuracy: Detect white balance shifts or unnatural tinting.\n\n"
                        "CONSTRAINT: Only analyze the physical environment and camera properties. Ignore biological subjects.\n\n"
                        "OUTPUT: Provide a detailed JSON object with a numeric score (0-100), a concise transcript of "
                        "findings, specific feedback, key strengths, and areas for improvement."
                    ),
                },
                *[
                    {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{frame}"}}
                    for frame in base64Frames
                ],
            ],
        },
    ]

    # ── Subsegment: OpenAI Analysis ────────────────────────────────────────
    # The OpenAI SDK is not auto-patched by X-Ray, so we wrap it manually.
    subsegment = xray_recorder.begin_subsegment('OpenAI Analysis')
    try:
        subsegment.put_annotation('model',       'gpt-4o-mini')
        subsegment.put_annotation('frame_count', len(base64Frames))
        subsegment.put_metadata('context_injected', bool(context_instruction), namespace='openai')

        # ── Chaos: simulate OpenAI timeout ─────────────────────────────────
        if _CHAOS_OPENAI_SLEEP > 0:
            print(f"[CHAOS] Sleeping {_CHAOS_OPENAI_SLEEP}s to simulate OpenAI timeout", flush=True)
            subsegment.put_annotation('chaos_openai_timeout', True)
            time.sleep(_CHAOS_OPENAI_SLEEP)

        print("Sending request to OpenAI...", flush=True)
        response = openai_client.chat.completions.create(
            model="gpt-4o-mini",
            messages=PROMPT_MESSAGES,
            max_tokens=1000,
            response_format={"type": "json_object"},
        )

        content = response.choices[0].message.content
        print(f"OpenAI Response: {content}", flush=True)

        # Record token usage so it's visible in the X-Ray trace
        if response.usage:
            subsegment.put_metadata('prompt_tokens',     response.usage.prompt_tokens,     namespace='openai')
            subsegment.put_metadata('completion_tokens', response.usage.completion_tokens, namespace='openai')
            subsegment.put_metadata('total_tokens',      response.usage.total_tokens,      namespace='openai')

        content = content.replace("```json", "").replace("```", "").strip()
        return json.loads(content)

    except Exception as e:
        print(f"OpenAI API Error/Refusal: {str(e)}", flush=True)
        subsegment.add_exception(e, traceback.extract_stack())
        raise
    finally:
        xray_recorder.end_subsegment()


def handler(event, context):
    print(">>> [LAMBDA] Worker Lambda Triggered", flush=True)
    print("Received event:", json.dumps(event), flush=True)

    # ── SQS Trigger (Processor) ────────────────────────────────────────────
    if 'Records' in event:
        print(f"Processing {len(event['Records'])} SQS records...", flush=True)

        for record in event['Records']:
            try:
                # ── Chaos: random failure injection ────────────────────────
                if _CHAOS_FAILURE_RATE > 0 and random.random() < _CHAOS_FAILURE_RATE:
                    raise RuntimeError(
                        f"[CHAOS] Simulated Lambda failure "
                        f"(rate={_CHAOS_FAILURE_RATE}, record={record.get('messageId', '?')})"
                    )

                sqs_body = json.loads(record['body'])
                print(f"SQS Body: {json.dumps(sqs_body)}", flush=True)

                if 'Records' not in sqs_body:
                    continue

                for s3_record in sqs_body['Records']:
                    s3_bucket = s3_record['s3']['bucket']['name']
                    s3_key    = unquote_plus(s3_record['s3']['object']['key'])
                    print(f">>> [S3/SQS] Triggered by object: s3://{s3_bucket}/{s3_key}", flush=True)

                    # Derive IDs early so we can annotate all subsegments
                    parts   = s3_key.split('/')
                    user_id = parts[0] if len(parts) > 1 else "unknown"
                    video_id = parts[1] if len(parts) > 1 else s3_key

                    # Annotate the root Lambda segment (searchable in X-Ray console)
                    try:
                        segment = xray_recorder.current_segment()
                        segment.put_annotation('user_id',  user_id)
                        segment.put_annotation('video_id', video_id)
                        segment.put_annotation('s3_bucket', s3_bucket)
                    except Exception:
                        pass  # tracing not available (local/test)

                    # ── Subsegment: S3 Metadata Fetch ──────────────────────
                    # boto3 is patched so the head_object call itself is traced
                    # automatically; this wrapper adds searchable metadata.
                    context_str = ""
                    subsegment = xray_recorder.begin_subsegment('S3 Metadata Fetch')
                    try:
                        subsegment.put_metadata('s3_key', s3_key, namespace='s3')
                        head_obj  = s3_client.head_object(Bucket=s3_bucket, Key=s3_key)
                        metadata  = head_obj.get('Metadata', {})
                        raw_context = metadata.get('context', '')
                        if raw_context:
                            try:
                                context_str = base64.b64decode(raw_context).decode('utf-8')
                            except Exception:
                                context_str = raw_context
                        subsegment.put_annotation('has_context', bool(context_str))
                        print(f"Context found: {context_str}", flush=True)
                    except Exception as meta_err:
                        print(f"Failed to fetch metadata: {meta_err}", flush=True)
                        subsegment.add_exception(meta_err, traceback.extract_stack())
                    finally:
                        xray_recorder.end_subsegment()

                    # ── Subsegment: S3 Download ────────────────────────────
                    download_path = f"/tmp/{uuid.uuid4()}.mp4"
                    subsegment = xray_recorder.begin_subsegment('S3 Download')
                    try:
                        subsegment.put_metadata('s3_key',       s3_key,        namespace='s3')
                        subsegment.put_metadata('download_path', download_path, namespace='s3')
                        print(f"Downloading to {download_path}...", flush=True)
                        s3_client.download_file(s3_bucket, s3_key, download_path)
                        file_size = os.path.getsize(download_path)
                        subsegment.put_annotation('file_size_bytes', file_size)
                    except Exception as dl_err:
                        subsegment.add_exception(dl_err, traceback.extract_stack())
                        raise
                    finally:
                        xray_recorder.end_subsegment()

                    # ── Analysis (contains its own Frame Extraction + OpenAI subsegments)
                    analysis_failed = False
                    try:
                        analysis_result = process_video_and_analyze(download_path, context_str)
                    except Exception as analysis_err:
                        print(f"Analysis failed: {analysis_err}", flush=True)
                        analysis_failed = True
                        analysis_result = {
                            'score':      0,
                            'transcript': 'Analysis failed',
                            'feedback':   str(analysis_err),
                        }

                    # Cleanup temp file
                    if os.path.exists(download_path):
                        os.remove(download_path)

                    result_status = 'failed' if analysis_failed else 'completed'

                    # Annotate root segment with outcome (visible in X-Ray search)
                    try:
                        segment = xray_recorder.current_segment()
                        segment.put_annotation('result_status', result_status)
                        if not analysis_failed:
                            segment.put_annotation('analysis_score', analysis_result.get('score', 0))
                    except Exception:
                        pass

                    # ── Subsegment: S3 Result Write ────────────────────────
                    results_bucket = os.environ.get('RESULTS_BUCKET_NAME')
                    if results_bucket:
                        result_key    = f"{user_id}/{video_id}.json"
                        analysis_data = {
                            'userId':    user_id,
                            'videoId':   video_id,
                            'status':    result_status,
                            's3_uri':    f"s3://{s3_bucket}/{s3_key}",
                            'analysis':  analysis_result,
                            'timestamp': s3_record['eventTime'],
                        }

                        subsegment = xray_recorder.begin_subsegment('S3 Result Write')
                        try:
                            subsegment.put_annotation('user_id',       user_id)
                            subsegment.put_annotation('result_status',  result_status)
                            subsegment.put_metadata('result_key',       result_key,     namespace='s3')
                            subsegment.put_metadata('results_bucket',   results_bucket, namespace='s3')

                            s3_client.put_object(
                                Bucket=results_bucket,
                                Key=result_key,
                                Body=json.dumps(analysis_data),
                                ContentType='application/json',
                            )
                            print(f">>> [S3] Successfully wrote analysis to s3://{results_bucket}/{result_key}", flush=True)
                        except Exception as write_err:
                            subsegment.add_exception(write_err, traceback.extract_stack())
                            raise
                        finally:
                            xray_recorder.end_subsegment()
                    else:
                        print("Error: RESULTS_BUCKET_NAME not set.", flush=True)

            except Exception as e:
                print(f"Error processing record: {e}", flush=True)
                raise

        return {'statusCode': 200, 'body': json.dumps('Processing complete')}

    # ── API Gateway Proxy Trigger ──────────────────────────────────────────
    if 'httpMethod' in event:
        print(f">>> [API GATEWAY] Triggered with method: {event['httpMethod']}", flush=True)
        return {
            'statusCode': 200,
            'body': json.dumps({'message': 'API Gateway trigger received', 'event_received': True}),
        }

    return {'statusCode': 400, 'body': json.dumps('Unknown event source')}
