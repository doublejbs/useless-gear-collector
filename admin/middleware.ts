import { NextRequest, NextResponse } from "next/server";
import { getIronSession } from "iron-session";
import type { SessionData } from "@/lib/auth";

// SESSION_OPTIONS는 lib/auth.ts와 동일한 값을 사용해야 함.
// 미들웨어는 Edge Runtime에서 실행되므로 next/headers를 사용하는 lib/auth.ts를 import할 수 없어 여기서 재정의한다.
const SESSION_OPTIONS = {
  password: process.env.SESSION_SECRET ?? "fallback-secret-do-not-use-in-prod",
  cookieName: "gear-admin-session",
};

export async function middleware(request: NextRequest) {
  const session = await getIronSession<SessionData>(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    request.cookies as any,
    SESSION_OPTIONS
  );

  if (!session.user?.isLoggedIn) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!login|_next/static|_next/image|favicon.ico).*)"],
};
