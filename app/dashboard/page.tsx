import { UploadArea } from "@/components/UploadArea"
import { auth } from "@/auth"

export default async function DashboardPage() {
    const session = await auth()

    return (
        <div className="max-w-7xl mx-auto space-y-8">
            <header className="flex items-center justify-between pb-6 border-b border-border">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight text-foreground">
                        Data Ingestion
                    </h1>
                    <p className="text-muted-foreground mt-1">
                        Upload and process video streams for analysis.
                    </p>
                </div>
                <div className="flex items-center gap-4">
                    <div className="text-right">
                        <p className="text-sm font-medium text-foreground">{session?.user?.name || "User"}</p>
                        <p className="text-xs text-muted-foreground font-mono">{session?.user?.email}</p>
                    </div>
                    <div className="h-10 w-10 rounded-full bg-primary/20 border border-primary/50 flex items-center justify-center text-primary font-bold">
                        {session?.user?.name?.[0] || "U"}
                    </div>
                </div>
            </header>

            <section className="py-12">
                <UploadArea />
            </section>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <StatCard title="Storage Used" value="45.2 GB" change="+2.4%" />
                <StatCard title="Files Processed" value="1,284" change="+12%" />
                <StatCard title="API Latency" value="24ms" change="-1.2%" />
            </div>
        </div>
    )
}

function StatCard({ title, value, change }: { title: string, value: string, change: string }) {
    const isPositive = change.startsWith("+")
    return (
        <div className="p-6 rounded-xl border border-border bg-secondary/10 hover:border-primary/30 transition-colors">
            <h3 className="text-sm font-medium text-muted-foreground">{title}</h3>
            <div className="mt-2 flex items-baseline gap-2">
                <span className="text-2xl font-bold text-foreground">{value}</span>
                <span className={isPositive ? "text-green-500 text-xs" : "text-primary text-xs"}>
                    {change}
                </span>
            </div>
        </div>
    )
}
