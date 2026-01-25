"use client"

import { useState, useRef, useEffect } from "react"
import { cn } from "@/lib/utils"
import { Upload, File, CheckCircle, AlertCircle, Loader2, X } from "lucide-react"

export function UploadArea() {
    const [isDragging, setIsDragging] = useState(false)
    const [file, setFile] = useState<File | null>(null)
    const [status, setStatus] = useState<"idle" | "uploading" | "processing" | "completed" | "error">("idle")
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
            const res = await fetch(`${apiUrl}/results/${uploadKey}.json`)

            if (res.status === 404 || res.status === 403) {
                alert("Analysis is still processing. Please try again in 30 seconds.")
            } else if (res.ok) {
                const data = await res.json()
                // Adjust for nested 'analysis' object if present (based on DynamoDB structure vs S3 structure)
                // In S3 we wrap it: { ...metadata, analysis: { score... } }
                // So we might want to display data.analysis or flattened. 
                // Let's pass the whole object but the UI expects specific fields.
                // If structure is { analysis: { score... } }, verify UI accessors.
                // The UI code uses analysisResult.score etc.
                // If the root object has score, fine. If it's in .analysis, we might need to map it.
                // Lambda writes: { userId, videoId, status, analysis: { score, ... } }
                // So we should use data.analysis for the main fields.

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
            // 1. Get Presigned URL or Cached Key
            const res = await fetch("/api/upload", {
                method: "POST",
                body: JSON.stringify({
                    filename: file.name,
                    contentType: file.type,
                    size: file.size,
                    lastModified: file.lastModified,
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
                    "Content-Type": file.type,
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
                    <div className="bg-background rounded-xl border border-border shadow-2xl w-full max-w-3xl max-h-[80vh] flex flex-col overflow-hidden">
                        <div className="flex justify-between items-center p-6 border-b border-border">
                            <h2 className="text-xl font-bold">Analysis Results</h2>
                            <button onClick={() => setIsModalOpen(false)} className="text-muted-foreground hover:text-foreground">
                                <X className="w-6 h-6" />
                            </button>
                        </div>
                        <div className="p-6 overflow-y-auto">
                            <div className="space-y-6">
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="p-4 rounded-lg bg-secondary/50 border border-border">
                                        <div className="text-sm text-muted-foreground">Score</div>
                                        <div className="text-3xl font-bold text-primary">{analysisResult.score}/100</div>
                                    </div>
                                    <div className="p-4 rounded-lg bg-secondary/50 border border-border">
                                        <div className="text-sm text-muted-foreground">Status</div>
                                        <div className="text-xl font-medium capitalize">{analysisResult.status || "Completed"}</div>
                                    </div>
                                </div>

                                <div>
                                    <h3 className="font-semibold mb-2">Technical Transcript</h3>
                                    <p className="text-sm text-muted-foreground bg-secondary/20 p-4 rounded-md border border-border">
                                        {analysisResult.transcript}
                                    </p>
                                </div>

                                <div>
                                    <h3 className="font-semibold mb-2">Feedback</h3>
                                    <p className="text-sm text-foreground">
                                        {analysisResult.feedback}
                                    </p>
                                </div>

                                <div className="grid md:grid-cols-2 gap-6">
                                    <div>
                                        <h3 className="font-semibold mb-2 text-green-500">Key Strengths</h3>
                                        <ul className="list-disc list-inside text-sm space-y-1 text-muted-foreground">
                                            {analysisResult.key_strengths?.map((item: string, i: number) => (
                                                <li key={i}>{item}</li>
                                            )) || <li>No specific strengths listed.</li>}
                                        </ul>
                                    </div>
                                    <div>
                                        <h3 className="font-semibold mb-2 text-orange-500">Areas for Improvement</h3>
                                        <ul className="list-disc list-inside text-sm space-y-1 text-muted-foreground">
                                            {analysisResult.areas_for_improvement?.map((item: string, i: number) => (
                                                <li key={i}>{item}</li>
                                            )) || <li>No specific improvements listed.</li>}
                                        </ul>
                                    </div>
                                </div>

                                <div>
                                    <h3 className="font-semibold mb-2">Raw JSON</h3>
                                    <pre className="bg-secondary/30 p-4 rounded-md overflow-x-auto text-xs font-mono border border-border">
                                        {JSON.stringify(analysisResult, null, 2)}
                                    </pre>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
