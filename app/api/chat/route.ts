import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"

export async function POST(req: NextRequest) {
    const session = await auth()
    if (!session) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    try {
        const { message } = await req.json()

        // TODO: Connect to an actual LLM (e.g., OpenAI, Anthropic, or allow user to configure)
        // For now, we'll keep the mock logic but server-side, or return a placeholder.

        const responseMessage = `Server received: ${message}. (Configure LLM logic in app/api/chat/route.ts)`

        return NextResponse.json({
            role: "assistant",
            content: responseMessage,
            timestamp: Date.now()
        })
    } catch (error) {
        console.error("Chat API error:", error)
        return NextResponse.json(
            { error: "Failed to process message" },
            { status: 500 }
        )
    }
}
