import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getPresignedUploadUrl } from "@/lib/aws/s3";
import { createHash } from "crypto";
import {
    httpRequestsTotal,
    httpRequestDurationSeconds,
    uploadsTotal,
    uploadFileSizeBytes,
} from "@/lib/metrics";

export async function POST(req: NextRequest) {
    const start = Date.now();
    const session = await auth();
    console.log(">>> [API] Upload Route Triggered");
    if (!session) {
        httpRequestsTotal.inc({ method: "POST", route: "/api/upload", status_code: 401 });
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const { filename, contentType, size, lastModified, context } = await req.json();

        if (!filename || !contentType) {
            httpRequestsTotal.inc({ method: "POST", route: "/api/upload", status_code: 400 });
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

        // Base64-encode context so it survives S3 metadata (header-safe)
        const contextMetadata: Record<string, string> = {};
        if (context) {
            const contextPayload = JSON.stringify({ history: context });
            contextMetadata.context = Buffer.from(contextPayload).toString("base64");
        }

        const url = await getPresignedUploadUrl(uniqueFilename, contentType, contextMetadata);

        // Record metrics
        const durationSecs = (Date.now() - start) / 1000;
        httpRequestsTotal.inc({ method: "POST", route: "/api/upload", status_code: 200 });
        httpRequestDurationSeconds.observe({ method: "POST", route: "/api/upload", status_code: 200 }, durationSecs);
        uploadsTotal.inc({ outcome: "success" });
        if (size) uploadFileSizeBytes.observe(size);

        return NextResponse.json({ url, key: uniqueFilename });
    } catch (error) {
        console.error("Error generating presigned URL:", error);
        const durationSecs = (Date.now() - start) / 1000;
        httpRequestsTotal.inc({ method: "POST", route: "/api/upload", status_code: 500 });
        httpRequestDurationSeconds.observe({ method: "POST", route: "/api/upload", status_code: 500 }, durationSecs);
        uploadsTotal.inc({ outcome: "error" });
        return NextResponse.json(
            { error: "Failed to generate upload URL" },
            { status: 500 }
        );
    }
}
