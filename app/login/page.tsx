import { signIn } from "@/auth"
import { Terminal } from "lucide-react"

export default function LoginPage() {
    return (
        <div className="min-h-screen flex items-center justify-center bg-background relative overflow-hidden">
            {/* Background Decor */}
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-primary/10 via-background to-background pointer-events-none" />

            <div className="w-full max-w-md p-8 rounded-2xl border border-border bg-black/40 backdrop-blur-xl shadow-2xl relative z-10">
                <div className="flex flex-col items-center text-center space-y-4 mb-8">
                    <div className="p-3 rounded-xl bg-primary/10 border border-primary/20 mb-2">
                        <Terminal className="w-8 h-8 text-primary" />
                    </div>
                    <h1 className="text-3xl font-bold tracking-tight text-foreground">
                        Engineering Login
                    </h1>
                    <p className="text-sm text-muted-foreground">
                        Secure access to the video analysis dashboard.
                    </p>
                </div>

                <div className="space-y-4">
                    <form
                        action={async () => {
                            "use server"
                            await signIn("google", { redirectTo: "/dashboard" })
                        }}
                    >
                        <button className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-secondary hover:bg-secondary/80 text-foreground rounded-lg border border-border transition-all">
                            {/* Google Icon could go here */}
                            <span className="font-medium">Continue with Google</span>
                        </button>
                    </form>

                    <form
                        action={async () => {
                            "use server"
                            await signIn("github", { redirectTo: "/dashboard" })
                        }}
                    >
                        <button className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-secondary hover:bg-secondary/80 text-foreground rounded-lg border border-border transition-all">
                            {/* GitHub Icon could go here */}
                            <span className="font-medium">Continue with GitHub</span>
                        </button>
                    </form>
                </div>

                <div className="mt-8 pt-6 border-t border-border text-center">
                    <p className="text-xs text-muted-foreground">
                        Restricted System. Authorized Personnel Only.
                    </p>
                </div>
            </div>
        </div>
    )
}
