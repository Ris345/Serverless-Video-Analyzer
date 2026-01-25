import json
import boto3
import os
from datetime import datetime

dynamodb = boto3.resource('dynamodb')
table_name = os.environ.get('table_name')
table = dynamodb.Table(table_name)

def handler(event, context):
    try:
        # Parse body
        body = json.loads(event.get('body', '{}'))
        user_email = body.get('email')
        
        if not user_email:
            return {
                "statusCode": 400,
                "body": json.dumps({"error": "Email is required"})
            }

        # Prepare item
        item = {
            'userEmail': user_email,
            'name': body.get('name', ''),
            'lastLogin': datetime.utcnow().isoformat(),
            'profile': body.get('profile', {})
        }

        # Write to DynamoDB
        table.put_item(Item=item)

        return {
            "statusCode": 200,
            "headers": {
                "Content-Type": "application/json" 
            },
            "body": json.dumps({
                "message": "Login successful", 
                "user": item
            })
        }
    except Exception as e:
        print(f"Error: {str(e)}")
        return {
            "statusCode": 500,
            "body": json.dumps({"error": str(e)})
        }

