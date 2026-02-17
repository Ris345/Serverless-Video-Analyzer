"use client"

import { useState, useRef, useEffect } from "react"
import { useChat } from "@/lib/contexts/ChatContext"
import { cn } from "@/lib/utils"
import { Send, Terminal, ChevronLeft, Trash2 } from "lucide-react"

export function ChatSidebar() {
    const { messages, addMessage, clearMessages, isOpen, toggleSidebar } = useChat()
    const [input, setInput] = useState("")
    const scrollRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight
        }
    }, [messages])

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!input.trim()) return

        const userMessage = input
        addMessage(userMessage, "user")
        setInput("")

        try {
            const res = await fetch("/api/chat", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    message: userMessage,
                    history: messages // Send context if needed
                })
            })

            if (!res.ok) throw new Error("Failed to send message")

            const data = await res.json()
            addMessage(data.content, "assistant")
        } catch (error) {
            console.error(error)
            addMessage("Error communicating with server.", "assistant")
        }
    }

    return (
        <>
            {/* Toggle Button */}
            <button
                onClick={toggleSidebar}
                className={cn(
                    "fixed top-4 left-4 z-50 p-2 rounded-md bg-secondary/80 border border-border backdrop-blur-sm transition-all hover:bg-accent",
                    isOpen && "left-[336px]"
                )}
            >
                {isOpen ? <ChevronLeft size={16} /> : <Terminal size={16} />}
            </button>

            {/* Sidebar */}
            <aside
                className={cn(
                    "fixed inset-y-0 left-0 z-40 w-80 bg-black/40 backdrop-blur-md border-r border-border flex flex-col transition-transform duration-300 ease-in-out",
                    !isOpen && "-translate-x-full"
                )}
            >
                <div className="h-16 flex items-center justify-between px-6 border-b border-border/50">
                    <div className="flex items-center">
                        <Terminal className="w-5 h-5 text-primary mr-2" />
                        <span className="font-mono font-bold text-sm tracking-wider uppercase text-foreground/80">
                            Context
                        </span>
                    </div>
                    <button
                        onClick={clearMessages}
                        disabled={messages.length === 0}
                        title="Clear Context"
                        className="p-1.5 text-muted-foreground hover:text-destructive transition-colors disabled:opacity-0"
                    >
                        <Trash2 size={14} />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-4 font-mono text-sm" ref={scrollRef}>
                    {messages.length === 0 && (
                        <div className="text-muted-foreground text-xs text-center mt-10 opacity-50">
                            System initialized. Waiting for input...
                        </div>
                    )}
                    {messages.map((msg) => (
                        <div
                            key={msg.id}
                            className={cn(
                                "flex flex-col gap-1 p-3 rounded-lg border",
                                msg.role === "assistant"
                                    ? "bg-secondary/30 border-secondary-foreground/10 self-start mr-8"
                                    : "bg-primary/5 border-primary/20 self-end ml-8"
                            )}
                        >
                            <div className="flex items-center gap-2 text-[10px] text-muted-foreground uppercase tracking-widest">
                                <span className={msg.role === "assistant" ? "text-primary" : "text-foreground"}>
                                    {msg.role === "assistant" ? "SYS" : "USR"}
                                </span>
                                <span>{new Date(msg.timestamp).toLocaleTimeString()}</span>
                            </div>
                            <p className="text-foreground/90 whitespace-pre-wrap leading-relaxed">
                                {msg.content}
                            </p>
                        </div>
                    ))}
                </div>

                <div className="p-4 border-t border-border/50 bg-black/20">
                    <form onSubmit={handleSubmit} className="relative">
                        <input
                            type="text"
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            placeholder="Enter command..."
                            className="w-full bg-secondary/50 border border-border/50 rounded-md py-2.5 pl-3 pr-10 text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 focus:border-primary/50 transition-all"
                        />
                        <button
                            type="submit"
                            disabled={!input.trim()}
                            className="absolute right-1 top-1 p-1.5 text-primary disabled:text-muted-foreground hover:text-primary/80 transition-colors"
                        >
                            <Send size={14} />
                        </button>
                    </form>
                </div>
            </aside>
        </>
    )
}
