

export default function Home() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex min-h-screen w-full flex-col items-center justify-center text-center p-8 bg-zinc-50 dark:bg-black">
        <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-6xl mb-6">
          Video Analyzer
        </h1>
        <p className="text-lg text-muted-foreground max-w-2xl mb-8">
          Upload your video streams for instant technical analysis and feedback using AI.
        </p>
        <div className="flex gap-4">
          <a
            href="/dashboard"
            className="rounded-full bg-primary px-8 py-3 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary transition-colors"
          >
            Go to Dashboard
          </a>
        </div>
      </main>
    </div>
  );
}
