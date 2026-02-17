"use client"

import React, { createContext, useContext, useState, useEffect } from "react"
// Native crypto.randomUUID() is available in secure contexts in browsers
// Actually 'crypto' is node only. Using web crypto or simple generator.

export type Message = {
    id: string
    role: "user" | "assistant"
    content: string
    timestamp: number
}

type ChatContextType = {
    messages: Message[]
    addMessage: (content: string, role?: "user" | "assistant") => void
    clearMessages: () => void
    isOpen: boolean
    setIsOpen: (isOpen: boolean) => void
    toggleSidebar: () => void
}

const ChatContext = createContext<ChatContextType | undefined>(undefined)

export function ChatProvider({ children }: { children: React.ReactNode }) {
    const [messages, setMessages] = useState<Message[]>([])
    const [isOpen, setIsOpen] = useState(true)

    // Load from local storage on mount (optional persistance)
    useEffect(() => {
        const saved = localStorage.getItem("chat-messages")
        if (saved) {
            try {
                // eslint-disable-next-line react-hooks/set-state-in-effect
                setMessages(JSON.parse(saved))
            } catch (e) {
                console.error("Failed to parse chat messages", e)
            }
        }
    }, [])

    useEffect(() => {
        localStorage.setItem("chat-messages", JSON.stringify(messages))
    }, [messages])

    const addMessage = (content: string, role: "user" | "assistant" = "user") => {
        const newMessage: Message = {
            id: crypto.randomUUID(),
            role,
            content,
            timestamp: Date.now(),
        }
        setMessages((prev) => [...prev, newMessage])
    }

    const clearMessages = () => {
        setMessages([])
        localStorage.removeItem("chat-messages")
    }

    const toggleSidebar = () => setIsOpen((prev) => !prev)

    return (
        <ChatContext.Provider
            value={{ messages, addMessage, clearMessages, isOpen, setIsOpen, toggleSidebar }}
        >
            {children}
        </ChatContext.Provider>
    )
}

export function useChat() {
    const context = useContext(ChatContext)
    if (context === undefined) {
        throw new Error("useChat must be used within a ChatProvider")
    }
    return context
}
