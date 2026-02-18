"use client"

import { useState, useRef, useEffect } from "react"
import { cn } from "@/lib/utils"
import { Upload, File, CheckCircle, AlertCircle, Loader2, X } from "lucide-react"
import { useChat } from "@/lib/contexts/ChatContext"

export function UploadArea() {
    const { messages } = useChat()
    const [isDragging, setIsDragging] = useState(false)
    const [file, setFile] = useState<File | null>(null)
    const [status, setStatus] = useState<"idle" | "compressing" | "uploading" | "processing" | "completed" | "error">("idle")
    const [errorMessage, setErrorMessage] = useState("")
    const [progress, setProgress] = useState(0)
    const [uploadKey, setUploadKey] = useState<string | null>(null)

    // Analysis Viewer State
    type AnalysisResult = {
        score: number
        status: string
        transcript: string
        feedback: string
        key_strengths: string[]
        areas_for_improvement: string[]
    }
    const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null)
    const [isModalOpen, setIsModalOpen] = useState(false)
    const [isLoadingAnalysis, setIsLoadingAnalysis] = useState(false)

    const fileInputRef = useRef<HTMLInputElement>(null)

    const fetchAnalysis = async () => {
        if (!uploadKey) return

        setIsLoadingAnalysis(true)
        try {
            const apiUrl = process.env.NEXT_PUBLIC_API_URL
            // Add timestamp to bypass browser cache
            const cacheBuster = new Date().getTime()
            const res = await fetch(`${apiUrl}/results/${uploadKey}.json?t=${cacheBuster}`)

            if (res.status === 404 || res.status === 403) {
                alert("Analysis is still processing. Please try again in 30 seconds.")
            } else if (res.ok) {
                const data = await res.json()
                const result = data.analysis ? { ...data.analysis, status: data.status } : data
                setAnalysisResult(result)
                setIsModalOpen(true)
            } else {
                throw new Error("Failed to fetch analysis")
            }
        } catch (error) {
            console.error(error)
            alert("Error fetching analysis. Please try again.")
        } finally {
            setIsLoadingAnalysis(false)
        }
    }

    // Polling effect
    useEffect(() => {
        let pollTimer: NodeJS.Timeout

        if (status === "processing" && uploadKey) {
            pollTimer = setInterval(async () => {
                try {
                    const res = await fetch(`/api/status?key=${uploadKey}`)
                    const data = await res.json()

                    if (data.status === "completed") {
                        setStatus("completed")
                    } else if (data.status === "failed") {
                        setStatus("error")
                        setErrorMessage("Processing failed")
                    } else {
                        // Still processing
                    }
                } catch (error) {
                    console.error("Polling error", error)
                }
            }, 5000)
        }

        return () => {
            if (pollTimer) clearInterval(pollTimer)
        }
    }, [status, uploadKey])


    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault()
        setIsDragging(true)
    }

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault()
        setIsDragging(false)
    }

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault()
        setIsDragging(false)
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            handleFileSelect(e.dataTransfer.files[0])
        }
    }

    const handleFileSelect = (selectedFile: File) => {
        setFile(selectedFile)
        setStatus("idle")
        setErrorMessage("")
        setProgress(0)
    }

    const startUpload = async () => {
        if (!file) return

        setStatus("uploading")
        setProgress(10)

        try {
            // 1. Get Presigned URL (include chat context for analysis)
            const chatContext = messages.length > 0
                ? messages.map(m => `${m.role}: ${m.content}`).join("\n")
                : ""

            const res = await fetch("/api/upload", {
                method: "POST",
                body: JSON.stringify({
                    filename: file.name,
                    contentType: file.type || "application/octet-stream",
                    size: file.size,
                    lastModified: file.lastModified,
                    context: chatContext,
                }),
            })

            if (!res.ok) throw new Error("Failed to get upload URL")

            const data = await res.json()

            // Handle cached result
            if (data.cached) {
                setUploadKey(data.key)
                setProgress(100)
                setStatus("completed")
                return
            }

            const { url, key } = data
            setUploadKey(key)
            setProgress(40)

            // 2. Upload to S3
            const uploadRes = await fetch(url, {
                method: "PUT",
                body: file,
                headers: {
                    "Content-Type": file.type || "application/octet-stream",
                },
            })

            if (!uploadRes.ok) throw new Error("Failed to upload to S3")

            setProgress(100)
            setStatus("processing")
        } catch (error) {
            console.error(error)
            setStatus("error")
            setErrorMessage("Upload failed. Please try again.")
        }
    }

    const reset = () => {
        setFile(null)
        setStatus("idle")
        setErrorMessage("")
        setProgress(0)
        setUploadKey(null)
        setAnalysisResult(null) // Clear previous result
        if (fileInputRef.current) fileInputRef.current.value = ""
    }

    return (
        <div className="w-full max-w-2xl mx-auto p-8">
            <div
                className={cn(
                    "relative border-2 border-dashed rounded-xl p-12 transition-all duration-300 flex flex-col items-center justify-center gap-4 text-center min-h-[400px]",
                    isDragging ? "border-primary bg-primary/5 scale-102" : "border-border bg-secondary/20 hover:border-primary/50 hover:bg-secondary/30",
                    status === "processing" && "border-primary/30 bg-primary/5 animate-pulse",
                    status === "completed" && "border-green-500/50 bg-green-500/5",
                    status === "error" && "border-destructive/50 bg-destructive/5"
                )}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
            >
                {status === "idle" && !file && (
                    <>
                        <div className="p-4 rounded-full bg-secondary border border-border">
                            <Upload className="w-8 h-8 text-primary" />
                        </div>
                        <div className="space-y-2">
                            <h3 className="font-bold text-lg text-foreground">Upload Data Stream</h3>
                            <p className="text-sm text-muted-foreground max-w-xs mx-auto">
                                Drag and drop your file here, or click to browse.
                                Supports video, audio, and large datasets.
                            </p>
                        </div>
                        <input
                            type="file"
                            className="hidden"
                            ref={fileInputRef}
                            onChange={(e) => e.target.files?.[0] && handleFileSelect(e.target.files[0])}
                        />
                        <button
                            onClick={() => fileInputRef.current?.click()}
                            className="px-6 py-2 bg-primary text-primary-foreground font-medium rounded-md hover:bg-primary/90 transition-colors"
                        >
                            Select File
                        </button>
                    </>
                )}

                {status === "idle" && file && (
                    <div className="flex flex-col items-center gap-6 w-full max-w-md animate-in fade-in zoom-in-95">
                        <div className="flex items-center gap-4 p-4 w-full bg-secondary border border-border rounded-lg">
                            <div className="p-3 bg-background rounded-md">
                                <File className="w-6 h-6 text-primary" />
                            </div>
                            <div className="flex-1 text-left overflow-hidden">
                                <p className="font-medium text-sm text-foreground truncate">{file.name}</p>
                                <p className="text-xs text-muted-foreground">{(file.size / (1024 * 1024)).toFixed(2)} MB</p>
                            </div>
                            <button onClick={reset} className="text-muted-foreground hover:text-foreground">
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                        <button
                            onClick={startUpload}
                            className="w-full py-3 bg-primary text-primary-foreground font-bold rounded-lg shadow-lg hover:shadow-primary/20 hover:bg-primary/90 transition-all active:scale-95"
                        >
                            Initialize Upload
                        </button>
                    </div>
                )}

                {status === "uploading" && (
                    <div className="w-full max-w-md space-y-4">
                        <div className="flex items-center justify-between text-sm">
                            <span className="text-primary font-mono animate-pulse">UPLOADING...</span>
                            <span className="text-muted-foreground font-mono">{progress}%</span>
                        </div>
                        <div className="h-2 w-full bg-secondary rounded-full overflow-hidden">
                            <div
                                className="h-full bg-primary transition-all duration-300 ease-out"
                                style={{ width: `${progress}%` }}
                            />
                        </div>
                    </div>
                )}


                {status === "processing" && (
                    <div className="flex flex-col items-center gap-4">
                        <Loader2 className="w-12 h-12 text-primary animate-spin" />
                        <div className="text-center space-y-1">
                            <h3 className="text-lg font-bold text-foreground">Processing Data</h3>
                            <p className="text-sm text-muted-foreground font-mono">Analysis in progress...</p>
                            <p className="text-xs text-primary/70 animate-pulse mt-2">Polling status every 5s</p>
                        </div>
                    </div>
                )}

                {status === "completed" && (
                    <div className="flex flex-col items-center gap-4">
                        <CheckCircle className="w-16 h-16 text-green-500" />
                        <div className="text-center space-y-1">
                            <h3 className="text-xl font-bold text-foreground">Upload Complete</h3>
                            <p className="text-sm text-muted-foreground">Data has been successfully processed.</p>
                        </div>
                        <div className="flex gap-4 mt-4">
                            <button onClick={reset} className="px-6 py-2 border border-border rounded-md hover:bg-secondary transition-colors text-sm">
                                Upload Another
                            </button>
                            <button
                                onClick={fetchAnalysis}
                                disabled={isLoadingAnalysis}
                                className="px-6 py-2 bg-primary text-primary-foreground font-medium rounded-md hover:bg-primary/90 transition-colors text-sm flex items-center gap-2"
                            >
                                {isLoadingAnalysis ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                                View Analysis
                            </button>
                        </div>
                    </div>
                )}

                {status === "error" && (
                    <div className="flex flex-col items-center gap-4">
                        <AlertCircle className="w-16 h-16 text-destructive" />
                        <div className="text-center space-y-1">
                            <h3 className="text-lg font-bold text-destructive">Error Occurred</h3>
                            <p className="text-sm text-muted-foreground">{errorMessage}</p>
                        </div>
                        <button onClick={reset} className="mt-4 px-6 py-2 bg-secondary text-foreground rounded-md hover:bg-secondary/80 transition-colors text-sm">
                            Try Again
                        </button>
                    </div>
                )}
            </div>

            {/* Analysis Modal */}
            {isModalOpen && analysisResult && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in">
                    <div className="bg-background rounded-xl border border-border shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden">

                        {/* Header */}
                        <div className="flex justify-between items-center p-6 border-b border-border bg-secondary/10">
                            <div>
                                <h2 className="text-2xl font-bold text-foreground">Analysis Results</h2>
                                <p className="text-sm text-muted-foreground">AI Technical Assessment</p>
                            </div>
                            <button onClick={() => setIsModalOpen(false)} className="text-muted-foreground hover:text-foreground">
                                <X className="w-6 h-6" />
                            </button>
                        </div>

                        <div className="p-6 overflow-y-auto space-y-8">

                            {/* Score Card */}
                            <div className="flex items-center justify-between bg-secondary/20 p-6 rounded-xl border border-border">
                                <div>
                                    <div className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Overall Score</div>
                                    <div className="mt-1 flex items-baseline gap-2">
                                        <span className={cn(
                                            "text-5xl font-black",
                                            analysisResult.score >= 80 ? "text-green-500" :
                                                analysisResult.score >= 60 ? "text-orange-500" : "text-destructive"
                                        )}>
                                            {analysisResult.score}
                                        </span>
                                        <span className="text-muted-foreground">/ 100</span>
                                    </div>
                                </div>
                                <div className="text-right">
                                    <div className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Status</div>
                                    <div className="mt-1 px-3 py-1 bg-primary/10 text-primary rounded-full text-sm font-semibold capitalize inline-block">
                                        {analysisResult.status || "Completed"}
                                    </div>
                                </div>
                            </div>

                            {/* Transcript & Feedback */}
                            <div className="space-y-4">
                                <div>
                                    <h3 className="text-lg font-semibold mb-2 flex items-center gap-2">
                                        📜 Transcript Summary
                                    </h3>
                                    <div className="text-sm text-foreground/80 leading-relaxed bg-secondary/30 p-4 rounded-lg border border-border/50">
                                        {analysisResult.transcript}
                                    </div>
                                </div>
                                <div>
                                    <h3 className="text-lg font-semibold mb-2 flex items-center gap-2">
                                        💡 Strategic Feedback
                                    </h3>
                                    <div className="text-sm text-foreground/80 leading-relaxed bg-blue-500/5 p-4 rounded-lg border border-blue-500/10">
                                        {analysisResult.feedback}
                                    </div>
                                </div>
                            </div>

                            {/* Strengths & Improvements */}
                            <div className="grid md:grid-cols-2 gap-6">
                                <div className="space-y-3">
                                    <h3 className="font-semibold text-green-600 flex items-center gap-2">
                                        <CheckCircle className="w-4 h-4" /> Key Strengths
                                    </h3>
                                    <ul className="space-y-2">
                                        {analysisResult.key_strengths?.map((item: string, i: number) => (
                                            <li key={i} className="flex gap-2 text-sm text-muted-foreground bg-green-500/5 p-2 rounded border border-green-500/10">
                                                <span className="text-green-500 mt-0.5">•</span> {item}
                                            </li>
                                        )) || <li className="text-sm text-muted-foreground italic">No specific strengths listed.</li>}
                                    </ul>
                                </div>
                                <div className="space-y-3">
                                    <h3 className="font-semibold text-orange-600 flex items-center gap-2">
                                        <AlertCircle className="w-4 h-4" /> Areas for Improvement
                                    </h3>
                                    <ul className="space-y-2">
                                        {analysisResult.areas_for_improvement?.map((item: string, i: number) => (
                                            <li key={i} className="flex gap-2 text-sm text-muted-foreground bg-orange-500/5 p-2 rounded border border-orange-500/10">
                                                <span className="text-orange-500 mt-0.5">•</span> {item}
                                            </li>
                                        )) || <li className="text-sm text-muted-foreground italic">No specific improvements listed.</li>}
                                    </ul>
                                </div>
                            </div>

                            {/* Raw JSON Toggle */}
                            <div className="pt-4 border-t border-border">
                                <details className="group">
                                    <summary className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-muted-foreground hover:text-primary transition-colors select-none">
                                        <span>⚙️ VIEW DEBUG JSON</span>
                                        <span className="group-open:rotate-180 transition-transform">▼</span>
                                    </summary>
                                    <div className="mt-4">
                                        <pre className="bg-black/80 text-green-400 p-4 rounded-lg overflow-x-auto text-xs font-mono border border-border shadow-inner">
                                            {JSON.stringify(analysisResult, null, 2)}
                                        </pre>
                                    </div>
                                </details>
                            </div>

                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
