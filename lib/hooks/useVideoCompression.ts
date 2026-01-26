import { useState, useRef } from "react"
import { FFmpeg } from "@ffmpeg/ffmpeg"
import { fetchFile, toBlobURL } from "@ffmpeg/util"

export function useVideoCompression() {
    const [isCompressing, setIsCompressing] = useState(false)
    const [compressionProgress, setCompressionProgress] = useState(0)
    const ffmpegRef = useRef<FFmpeg | null>(null)
    const messageRef = useRef<HTMLElement | null>(null)

    const load = async () => {
        const baseURL = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd"
        // TODO: Download core files via toBlobURL to bypass CORS if possible, 
        // but for now relying on unpkg which usually supports CORS.
        // If specific headers are needed, they are set in next.config.ts.
        // If specific headers are needed, they are set in next.config.ts.

        if (!ffmpegRef.current) {
            ffmpegRef.current = new FFmpeg();
        }

        const ffmpeg = ffmpegRef.current
        ffmpeg.on("log", ({ message }) => {
            console.log(message)
        })
        ffmpeg.on("progress", ({ progress }) => {
            setCompressionProgress(Math.round(progress * 100))
        })

        await ffmpeg.load({
            coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
            wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm"),
        })
    }

    const compress = async (file: File): Promise<Blob> => {
        setIsCompressing(true)
        setCompressionProgress(0)

        try {
            if (!ffmpegRef.current) {
                await load()
            }
            const ffmpeg = ffmpegRef.current! // Assert non-null after load calls

            if (!ffmpeg.loaded) {
                await load()
            }

            const inputName = "input.mp4"
            const outputName = "output.mp4"

            await ffmpeg.writeFile(inputName, await fetchFile(file))

            // Compress: 720p, CRF 28 (medium quality/size)
            await ffmpeg.exec([
                "-i", inputName,
                "-vf", "scale=-2:720",
                "-c:v", "libx264",
                "-crf", "28",
                "-preset", "faster",
                outputName
            ])

            const data = await ffmpeg.readFile(outputName)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const blob = new Blob([data as any], { type: "video/mp4" })
            return blob
        } catch (error) {
            console.error("Compression error:", error)
            throw error
        } finally {
            setIsCompressing(false)
        }
    }

    return { compress, isCompressing, compressionProgress }
}
