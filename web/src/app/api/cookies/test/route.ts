import { NextResponse } from "next/server";
import { getConfig } from "@/lib/db";

export async function POST() {
  const encryptionKey = process.env.ENCRYPTION_KEY || "";
  if (!encryptionKey) {
    return NextResponse.json({ ok: false, error: "Encryption key not configured" }, { status: 500 });
  }

  const encrypted = getConfig("ig_cookies");
  if (!encrypted) {
    return NextResponse.json({ ok: false, error: "No cookies configured" }, { status: 400 });
  }

  const { Fernet } = await import("@/lib/fernet");
  const fernet = new Fernet(encryptionKey);
  let cookies: { sessionid: string; csrftoken: string; ds_user_id: string };
  try {
    cookies = JSON.parse(fernet.decrypt(encrypted));
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to decrypt cookies" }, { status: 500 });
  }

  try {
    const res = await fetch("https://i.instagram.com/api/v1/accounts/current_user/?edit=true", {
      headers: {
        "Cookie": `sessionid=${cookies.sessionid}; csrftoken=${cookies.csrftoken}; ds_user_id=${cookies.ds_user_id}`,
        "User-Agent": "Instagram 275.0.0.27.98 Android",
        "X-IG-App-ID": "936619743392459",
      },
    });

    if (res.ok) {
      const data = await res.json();
      const username = data?.user?.username;
      return NextResponse.json({ ok: true, username: username || "unknown" });
    }

    return NextResponse.json({ ok: false, error: `Instagram returned ${res.status}` });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Network error" });
  }
}
