import json
import os
import boto3
import cv2
import base64
import math
import uuid
from botocore.exceptions import ClientError
from urllib.parse import unquote_plus
from openai import OpenAI

# Initialize clients
s3_client = boto3.client('s3')

openai_api_key = os.environ.get('OPENAI_API_KEY')
openai_client = OpenAI(api_key=openai_api_key, timeout=800.0) if openai_api_key else None

def process_video_and_analyze(video_path, context_text=""):
    """
    Extracts frames from the video and sends them to OpenAI for analysis.
    Returns the analysis JSON.
    """
    if not openai_client:
        raise ValueError("OpenAI API Key is missing.")

    print(f"Extracting frames from {video_path}...", flush=True)
    video = cv2.VideoCapture(video_path)
    
    base64Frames = []
    fps = video.get(cv2.CAP_PROP_FPS)
    total_frames = int(video.get(cv2.CAP_PROP_FRAME_COUNT))
    duration = total_frames / fps if fps > 0 else 0
    
    print(f"Video Info: FPS={fps}, Total Frames={total_frames}, Duration={duration}s", flush=True)

    # Extract one frame per second to keep payload size manageable
    frame_interval = int(fps) if fps > 0 else 30
    
    frame_count = 0
    while video.isOpened():
        success, frame = video.read()
        if not success:
            break
        
        if frame_count % frame_interval == 0:
            _, buffer = cv2.imencode(".jpg", frame)
            base64Frames.append(base64.b64encode(buffer).decode("utf-8"))
        
        frame_count += 1
    
    video.release()
    print(f"Extracted {len(base64Frames)} frames.", flush=True)

    if not base64Frames:
        raise ValueError("No frames extracted from video.")

    # Optimization: Limit to 20 frames (down from 50) for speed
    if len(base64Frames) > 20:
         print(f"Resampling frames from {len(base64Frames)} to 20...", flush=True)
         step = len(base64Frames) / 20
         base64Frames = [base64Frames[int(i * step)] for i in range(20)]

    print("Sending request to OpenAI...", flush=True)
    
    # Inject user context if present
    context_instruction = ""
    if context_text:
        try:
             # Context is stored as JSON string in metadata: {"history": "..."}
             ctx_json = json.loads(context_text)
             history = ctx_json.get('history', '')
             if history:
                 context_instruction = f"USER CONTEXT / CHAT HISTORY:\n{history}\n\nINSTRUCTION: Incorporate the user's focus areas from the context above into your analysis."
        except:
             context_instruction = f"USER CONTEXT: {context_text}"

    PROMPT_MESSAGES = [
        {
            "role": "user",
            "content": [
                {
                    "type": "text",
                    "text": f"TASK: Technical Video Analysis.\n{context_instruction}\n\nOBJECTIVE: Evaluate the technical quality of this video feed across four metrics:\n1. Lighting Uniformity: Identify shadow areas or overexposed glare.\n2. Focus Sharpness: Evaluate if edges are crisp or if there is motion blur.\n3. Frame Composition: Assess the alignment and positioning of the primary subject.\n4. Color Accuracy: Detect white balance shifts or unnatural tinting.\n\nCONSTRAINT: Only analyze the physical environment and camera properties. Ignore biological subjects.\n\nOUTPUT: Provide a detailed JSON object with a numeric score (0-100), a concise transcript of findings, specific feedback, key strengths, and areas for improvement."
                },
                *[
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:image/jpeg;base64,{frame}"
                        }
                    } for frame in base64Frames
                ]
            ],
        },
    ]
    
    try:
        response = openai_client.chat.completions.create(
            model="gpt-4o-mini",
            messages=PROMPT_MESSAGES,
            max_tokens=1000,
            response_format={"type": "json_object"}
        )
        
        content = response.choices[0].message.content
        print(f"OpenAI Response: {content}", flush=True)
        
        # Strip markdown if present (though response_format handles this mostly)
        content = content.replace("```json", "").replace("```", "").strip()
            
        return json.loads(content)

    except Exception as e:
        print(f"OpenAI API Error/Refusal: {str(e)}", flush=True)
        # Propagate error to mark processing as failed
        raise e

def handler(event, context):
    print(">>> [LAMBDA] Worker Lambda Triggered", flush=True)
    print("Received event:", json.dumps(event), flush=True)
    
    # SQS Trigger (Processor)
    if 'Records' in event:
        print(f"Processing {len(event['Records'])} SQS records...", flush=True)
        for record in event['Records']:
            try:
                # SQS wraps the S3 event
                sqs_body = json.loads(record['body'])
                print(f"SQS Body: {json.dumps(sqs_body)}", flush=True)
                
                if 'Records' in sqs_body:
                    for s3_record in sqs_body['Records']:
                        s3_bucket = s3_record['s3']['bucket']['name']
                        s3_key = unquote_plus(s3_record['s3']['object']['key'])
                        print(f">>> [S3/SQS] Triggered by object: s3://{s3_bucket}/{s3_key}", flush=True)
                        
                        # 1. Fetch Metadata (Context)
                        try:
                            head_obj = s3_client.head_object(Bucket=s3_bucket, Key=s3_key)
                            metadata = head_obj.get('Metadata', {})
                            raw_context = metadata.get('context', '')
                            if raw_context:
                                try:
                                    context_str = base64.b64decode(raw_context).decode('utf-8')
                                except Exception:
                                    context_str = raw_context 
                            else:
                                context_str = ''
                            print(f"Context found: {context_str}", flush=True)
                        except Exception as meta_err:
                            print(f"Failed to fetch metadata: {meta_err}", flush=True)
                            context_str = ""

                        # 2. Download Video
                        download_path = f"/tmp/{uuid.uuid4()}.mp4"
                        print(f"Downloading to {download_path}...", flush=True)
                        s3_client.download_file(s3_bucket, s3_key, download_path)
                        
                        # 3. Analyze
                        analysis_failed = False
                        try:
                            analysis_result = process_video_and_analyze(download_path, context_str)
                        except Exception as analysis_err:
                            print(f"Analysis failed: {analysis_err}", flush=True)
                            analysis_failed = True
                            analysis_result = {
                                'score': 0,
                                'transcript': 'Analysis failed',
                                'feedback': str(analysis_err)
                            }

                        # Cleanup
                        if os.path.exists(download_path):
                            os.remove(download_path)

                        # 4. Save to S3 (Analysis Bucket)
                        parts = s3_key.split('/')
                        user_id = parts[0] if len(parts) > 1 else "unknown"
                        video_id = parts[1] if len(parts) > 1 else s3_key

                        print(f"Identified UserID: {user_id}, VideoID: {video_id}", flush=True)

                        result_status = 'failed' if analysis_failed else 'completed'
                        analysis_data = {
                            'userId': user_id,
                            'videoId': video_id,
                            'status': result_status,
                            's3_uri': f"s3://{s3_bucket}/{s3_key}",
                            'analysis': analysis_result,
                            'timestamp': s3_record['eventTime']
                        }
                        
                        results_bucket = os.environ.get('RESULTS_BUCKET_NAME')
                        if results_bucket:
                            result_key = f"{user_id}/{video_id}.json"
                            s3_client.put_object(
                                Bucket=results_bucket,
                                Key=result_key,
                                Body=json.dumps(analysis_data),
                                ContentType='application/json'
                            )
                            print(f">>> [S3] Successfully wrote analysis to S3: s3://{results_bucket}/{result_key}", flush=True)
                        else:
                            print("Error: RESULTS_BUCKET_NAME not set.", flush=True)

            except Exception as e:
                print(f"Error processing record: {e}", flush=True)
                raise
                
        return {'statusCode': 200, 'body': json.dumps('Processing complete')}

    # API Gateway Proxy Trigger (Results Fetcher)
    if 'httpMethod' in event:
        print(f">>> [API GATEWAY] Triggered with method: {event['httpMethod']}", flush=True)
        return {'statusCode': 200, 'body': json.dumps({'message': 'API Gateway trigger received', 'event_received': True})}
    
    return {'statusCode': 400, 'body': json.dumps('Unknown event source')}
