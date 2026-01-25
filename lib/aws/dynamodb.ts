import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";

if (!process.env.AWS_REGION) {
    // console.warn("AWS_REGION is not set, defaulting to us-east-1");
}

const config = {
    region: process.env.AWS_REGION || "us-east-1",
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || "",
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "",
    },
};

export const client = new DynamoDBClient(config);
export const docClient = DynamoDBDocument.from(client);

