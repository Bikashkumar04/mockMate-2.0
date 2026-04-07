import { createAuthClient } from "better-auth/react"

const authClient = createAuthClient({
  /** The base URL of the server */
  baseURL:
    process.env.NEXT_PUBLIC_AUTH_URL ??
    (typeof window !== "undefined" ? window.location.origin : undefined),
})

export const { signIn, signUp, signOut, useSession } = authClient
