import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { S3Client, HeadObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import {
    httpRequestsTotal,
    httpRequestDurationSeconds,
    processingPollsTotal,
} from "@/lib/metrics";

const s3Client = new S3Client({
    region: process.env.AWS_REGION || "us-east-1",
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    },
});

export async function GET(req: NextRequest) {
    const start = Date.now();
    const session = await auth();
    console.log(">>> [API] Status Route Triggered");
    if (!session) {
        httpRequestsTotal.inc({ method: "GET", route: "/api/status", status_code: 401 });
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const searchParams = req.nextUrl.searchParams;
    const key = searchParams.get("key"); // This is the uniqueFilename: "user@email.com/id-filename"

    if (!key) {
        httpRequestsTotal.inc({ method: "GET", route: "/api/status", status_code: 400 });
        return NextResponse.json({ error: "Key required" }, { status: 400 });
    }

    const resultsBucket = process.env.RESULTS_BUCKET_NAME;
    if (!resultsBucket) {
        httpRequestsTotal.inc({ method: "GET", route: "/api/status", status_code: 500 });
        return NextResponse.json({ error: "Results bucket not configured" }, { status: 500 });
    }

    // Result key format in S3 results bucket: "userEmail/videoId.json"
    const resultKey = `${key}.json`;

    const recordAndReturn = (response: NextResponse, pollResult: string, statusCode: number) => {
        const durationSecs = (Date.now() - start) / 1000;
        httpRequestsTotal.inc({ method: "GET", route: "/api/status", status_code: statusCode });
        httpRequestDurationSeconds.observe({ method: "GET", route: "/api/status", status_code: statusCode }, durationSecs);
        processingPollsTotal.inc({ result: pollResult });
        return response;
    };

    try {
        // 1. Check if result exists in S3 results bucket
        const headCommand = new HeadObjectCommand({
            Bucket: resultsBucket,
            Key: resultKey,
        });

        try {
            await s3Client.send(headCommand);

            // 2. Result found, fetch and return data
            const getCommand = new GetObjectCommand({
                Bucket: resultsBucket,
                Key: resultKey,
            });
            const response = await s3Client.send(getCommand);
            const rawBody = await response.Body?.transformToString();

            if (!rawBody) throw new Error("Result file empty");

            const analysisData = JSON.parse(rawBody);

            return recordAndReturn(
                NextResponse.json({ status: "completed", data: analysisData }),
                "completed",
                200
            );

        } catch (error: any) {
            if (error.name === "NotFound" || error.$metadata?.httpStatusCode === 404) {
                return recordAndReturn(
                    NextResponse.json({ status: "processing" }),
                    "processing",
                    200
                );
            }
            throw error;
        }

    } catch (error) {
        console.error("Error checking S3 status:", error);
        return recordAndReturn(
            NextResponse.json({ status: "processing" }),
            "failed",
            200
        );
    }
}
