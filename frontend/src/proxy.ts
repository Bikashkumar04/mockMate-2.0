import { NextRequest, NextResponse } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

/**
 * Middleware — optimistic cookie-based route guard.
 *
 * Fast check: if no session cookie exists, redirect to /login.
 * Each protected page/route performs the definitive server-side validation
 * (ownership checks, full session validation) as a second layer.
 */
export function proxy(request: NextRequest) {
  const sessionCookie = getSessionCookie(request);

  if (!sessionCookie) {
    const loginUrl = new URL("/login", request.url);
    // Preserve the intended destination so we can redirect back after login
    loginUrl.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/dashboard",
    "/dashboard/:path*",
    "/interview/:path*",
    "/resume",
    "/resume/:path*",
    "/sessions",
    "/sessions/:path*",
    "/cookies",
  ],
};
