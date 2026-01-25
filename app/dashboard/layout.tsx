import { ChatProvider } from "@/lib/contexts/ChatContext"
import { ChatSidebar } from "@/components/ChatSidebar"
import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { MainContent } from "../../components/MainContent"

export default async function DashboardLayout({
    children,
}: {
    children: React.ReactNode
}) {
    const session = await auth()
    if (!session) {
        redirect("/login")
    }

    return (
        <ChatProvider>
            <div className="flex h-screen overflow-hidden bg-background relative isolate">
                <ChatSidebar />
                <main className="flex-1 overflow-auto transition-all duration-300 w-full pl-0 peer-has-[:checked]:pl-80">
                    {/* 
                   Note: The sidebar is fixed and has a toggle. 
                   We could adjust main padding based on sidebar state using context, 
                   but since Sidebar is Client and this Layout is Server, 
                   we let the Sidebar handle its own positioning or use a wrapper.
                   
                   Better approach: Wrap the main content in a Client Component that 
                   consumes ChatContext to adjust padding/margin, OR just let the sidebar overlap 
                   (as "Context Chat" implies an overlay or side panel).
                   
                   For "Engineering Aesthetic", a collapsible sidebar that pushes content is nice.
                   I will create a MainContentWrapper to handle the layout shift.
                */}
                    <MainContent>
                        {children}
                    </MainContent>
                </main>
            </div>
        </ChatProvider>
    )
}


