import { getIronSession } from "iron-session";
import { cookies } from "next/headers";

export interface SessionData {
  user?: { isLoggedIn: boolean };
}

export const SESSION_OPTIONS = {
  password: process.env.SESSION_SECRET!,
  cookieName: "gear-admin-session",
  cookieOptions: {
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 7, // 7일
  },
};

export async function getSession() {
  const cookieStore = await cookies();
  return getIronSession<SessionData>(cookieStore, SESSION_OPTIONS);
}
