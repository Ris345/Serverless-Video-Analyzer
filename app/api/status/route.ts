import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { docClient } from "@/lib/aws/dynamodb";

export async function GET(req: NextRequest) {
    const session = await auth();
    if (!session) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const searchParams = req.nextUrl.searchParams;
    const key = searchParams.get("key");

    if (!key) {
        return NextResponse.json({ error: "Key required" }, { status: 400 });
    }

    // Parse key: "userId/videoId"
    const parts = key.split('/');
    if (parts.length < 2) {
        return NextResponse.json({ status: "processing", key });
    }

    const userId = parts[0];
    const videoId = parts[1];

    try {
        const result = await docClient.get({
            TableName: "InterviewAnalysis", // Matches Terraform
            Key: {
                userId: userId,
                videoId: videoId
            }
        });

        if (result.Item) {
            return NextResponse.json({
                status: "completed",
                data: result.Item
            });
        }

        return NextResponse.json({ status: "processing" });

    } catch (error) {
        console.error("Error checking status:", error);
        // Return processing so polling continues instead of crashing
        return NextResponse.json({ status: "processing" });
    }
}
