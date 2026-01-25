"use client"

import { useChat } from "@/lib/contexts/ChatContext"
import { cn } from "@/lib/utils"

export function MainContent({ children }: { children: React.ReactNode }) {
    const { isOpen } = useChat()

    return (
        <div
            className={cn(
                "h-full w-full transition-all duration-300 ease-in-out p-6",
                isOpen ? "pl-80" : "pl-0"
            )}
        >
            {children}
        </div>
    )
}
