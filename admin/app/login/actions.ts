"use server";

import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";

export async function loginAction(formData: FormData): Promise<never> {
  const password = formData.get("password") as string;

  if (!password || password !== process.env.ADMIN_PASSWORD) {
    redirect("/login?error=1");
  }

  const session = await getSession();
  session.user = { isLoggedIn: true };
  await session.save();

  redirect("/");
}
