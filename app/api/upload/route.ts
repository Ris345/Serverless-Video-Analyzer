import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getPresignedUploadUrl } from "@/lib/aws/s3";
import { docClient } from "@/lib/aws/dynamodb"; // Import docClient
import { createHash } from "crypto"; // Import createHash for MD5

export async function POST(req: NextRequest) {
    const session = await auth();
    if (!session) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const { filename, contentType, size, lastModified } = await req.json();

        if (!filename || !contentType) {
            return NextResponse.json(
                { error: "Filename and content type are required" },
                { status: 400 }
            );
        }

        // Generate deterministic ID
        const fingerprint = `${filename}-${size}-${lastModified}`;
        const deterministicId = createHash("md5").update(fingerprint).digest("hex");

        const userEmail = session.user?.email || "unknown";
        const uniqueFilename = `${userEmail}/${deterministicId}-${filename}`;

        // Check DynamoDB for existing analysis
        try {
            // videoId in DynamoDB is just the filename part (suffix)
            const videoIdSuffix = `${deterministicId}-${filename}`;

            const existing = await docClient.get({
                TableName: "InterviewAnalysis",
                Key: {
                    userId: userEmail,
                    videoId: videoIdSuffix
                }
            });

            if (existing.Item && existing.Item.status === "completed") {
                console.log("Found cached analysis for:", uniqueFilename);
                return NextResponse.json({
                    cached: true,
                    key: uniqueFilename
                });
            }
        } catch (dbError) {
            console.warn("Error checking cache:", dbError);
            // Continue with upload if cache check fails
        }

        const url = await getPresignedUploadUrl(uniqueFilename, contentType);

        return NextResponse.json({ url, key: uniqueFilename });
    } catch (error) {
        console.error("Error generating presigned URL:", error);
        return NextResponse.json(
            { error: "Failed to generate upload URL" },
            { status: 500 }
        );
    }
}
