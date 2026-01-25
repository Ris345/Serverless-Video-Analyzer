import json
import boto3
import os

s3_client = boto3.client('s3')
results_bucket = os.environ.get('RESULTS_BUCKET_NAME')

def handler(event, context):
    try:
        # Get userId from path parameters
        path_params = event.get('pathParameters', {})
        user_id = path_params.get('userId')
        
        if not user_id:
            return {
                "statusCode": 400,
                "body": json.dumps({"error": "UserId is required"})
            }
        
        if not results_bucket:
             return {
                "statusCode": 500,
                "body": json.dumps({"error": "RESULTS_BUCKET_NAME not configured"})
            }

        # List objects in S3 bucket for the user prefix
        prefix = f"{user_id}/"
        response = s3_client.list_objects_v2(Bucket=results_bucket, Prefix=prefix)
        
        items = []
        if 'Contents' in response:
            for obj in response['Contents']:
                # Read each JSON file
                # Optimization: In production, might want clear separation or index, but for now reading is fine for small scale
                try:
                    obj_resp = s3_client.get_object(Bucket=results_bucket, Key=obj['Key'])
                    content = obj_resp['Body'].read().decode('utf-8')
                    items.append(json.loads(content))
                except Exception as read_err:
                    print(f"Error reading {obj['Key']}: {read_err}")
                    continue

        return {
            "statusCode": 200,
            "headers": {
                "Content-Type": "application/json"
            },
            "body": json.dumps({
                "count": len(items),
                "data": items
            }, default=str)
        }
    except Exception as e:
        print(f"Error: {str(e)}")
        return {
            "statusCode": 500,
            "body": json.dumps({"error": str(e)})
        }
