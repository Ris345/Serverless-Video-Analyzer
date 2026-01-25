import NextAuth from "next-auth"
import { DynamoDBAdapter } from "@auth/dynamodb-adapter"
import { docClient } from "@/lib/aws/dynamodb"
import { authConfig } from "./auth.config"
import Google from "next-auth/providers/google"
import GitHub from "next-auth/providers/github"

export const { auth, handlers, signIn, signOut } = NextAuth({
    adapter: DynamoDBAdapter(docClient),
    session: { strategy: "jwt" }, // Use JWT for session to avoid excessive DB lookups if preferred, or "database" for strict server-side
    ...authConfig,
    providers: [
        Google,
        GitHub
    ],
})
