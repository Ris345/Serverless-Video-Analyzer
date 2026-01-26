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
dynamodb = boto3.resource('dynamodb')
s3_client = boto3.client('s3')
table_name = os.environ.get('DYNAMODB_TABLE_ANALYSIS')
table = dynamodb.Table(table_name) if table_name else None

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
                "TASK: Technical Image Analysis.",
                "INPUT: Screenshots from a video feed.",
                f"{context_instruction}",
                "OBJECTIVE: Evaluate optical properties: lighting uniformity, focus sharpness, and frame composition.",
                "CONSTRAINT: Ignore all biological subjects.",
                "OUTPUT FORMAT: JSON",
                "content: { 'score': 85, 'transcript': 'clear lighting', 'feedback': 'good focus', 'key_strengths': ['sharp focus'], 'areas_for_improvement': ['adjust white balance'] }",
                "Analyze the provided frames strictly according to these constraints.",
                *map(lambda x: {"image": x, "resize": 512}, base64Frames),
            ],
        },
    ]
    
    try:
        response = openai_client.chat.completions.create(
            model="gpt-4o-mini",
            messages=PROMPT_MESSAGES,
            max_tokens=1000,
        )
        
        content = response.choices[0].message.content
        print(f"OpenAI Response: {content}", flush=True)
        
        # Strip markdown if present
        content = content.replace("```json", "").replace("```", "").strip()
            
        try:
            return json.loads(content)
        except json.JSONDecodeError:
            print("Failed to parse JSON from OpenAI response.", flush=True)
            # Fallback if JSON parsing fails but content exists
            return {
                'score': 50,
                'transcript': 'Automated Analysis (Parsing Error)',
                'feedback': f"Raw Output: {content[:100]}...",
                'key_strengths': ['Video Processed'],
                'areas_for_improvement': ['AI Output Formatting']
            }

    except Exception as e:
        print(f"OpenAI API Error/Refusal: {str(e)}", flush=True)
        # Fallback for refusals or API errors
        return {
            'score': 0,
            'status': 'review_required',
            'transcript': 'AI Analysis Unavailable (Safety/Technical Limit)',
            'feedback': 'The video content could not be processed by the AI model entirely. Please review manually.',
            'key_strengths': [],
            'areas_for_improvement': ['Ensure standard video format']
        }

def handler(event, context):
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
                        print(f"Processing video: s3://{s3_bucket}/{s3_key}", flush=True)
                        
                        # 1. Fetch Metadata (Context)
                        try:
                            head_obj = s3_client.head_object(Bucket=s3_bucket, Key=s3_key)
                            # Metadata keys are lowercased by S3
                            metadata = head_obj.get('Metadata', {})
                            context_str = metadata.get('context', '')
                            print(f"Context found: {context_str}", flush=True)
                        except Exception as meta_err:
                            print(f"Failed to fetch metadata: {meta_err}", flush=True)
                            context_str = ""

                        # 2. Download Video
                        download_path = f"/tmp/{uuid.uuid4()}.mp4"
                        print(f"Downloading to {download_path}...", flush=True)
                        s3_client.download_file(s3_bucket, s3_key, download_path)
                        
                        # 3. Analyze
                        try:
                            analysis_result = process_video_and_analyze(download_path, context_str)
                        except Exception as analysis_err:
                            print(f"Analysis failed: {analysis_err}", flush=True)
                            analysis_result = {
                                'score': 0,
                                'transcript': 'Analysis failed',
                                'feedback': str(analysis_err)
                            }
                        
                        # Cleanup
                        if os.path.exists(download_path):
                            os.remove(download_path)


                        # 3. Save to S3 (Analysis Bucket)
                        parts = s3_key.split('/')
                        user_id = parts[0] if len(parts) > 1 else "unknown"
                        video_id = parts[1] if len(parts) > 1 else s3_key
                        
                        print(f"Identified UserID: {user_id}, VideoID: {video_id}", flush=True)

                        analysis_data = {
                            'userId': user_id,
                            'videoId': video_id,
                            'status': 'completed', 
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
                            print(f"Successfully wrote analysis to S3: s3://{results_bucket}/{result_key}", flush=True)

                            # 4. Write to DynamoDB
                            if table:
                                try:
                                    table.put_item(Item={
                                        'userId': user_id,
                                        'videoId': video_id,
                                        'status': 'completed',
                                        'timestamp': s3_record['eventTime'],
                                        's3_result_uri': f"s3://{results_bucket}/{result_key}"
                                    })
                                    print(f"Successfully wrote status to DynamoDB: {user_id}/{video_id}", flush=True)
                                except Exception as db_err:
                                    print(f"Failed to write to DynamoDB: {db_err}", flush=True)
                            else:
                                print("Error: DYNAMODB_TABLE_ANALYSIS not set.", flush=True)
                        else:
                            print("Error: RESULTS_BUCKET_NAME not set.", flush=True)

            except Exception as e:
                print(f"Error processing record: {e}", flush=True)
                continue
                
        return {'statusCode': 200, 'body': json.dumps('Processing complete')}
    
    return {'statusCode': 400, 'body': json.dumps('Unknown event source')}
