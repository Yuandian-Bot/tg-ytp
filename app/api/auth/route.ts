import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE, authToken } from "@/lib/auth-token";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const expected = process.env.APP_PASSWORD;
  if (!expected) {
    return NextResponse.json({ configured: false });
  }
  const token = request.cookies.get(AUTH_COOKIE)?.value;
  const authed = token === (await authToken(expected));
  return NextResponse.json({ configured: true, authed, token: authed ? token : null });
}

export async function POST(request: Request) {
  const expected = process.env.APP_PASSWORD;
  if (!expected) {
    return NextResponse.json(
      {
        error: {
          code: "NOT_CONFIGURED",
          message: "尚未设置 APP_PASSWORD，无法启用访问保护。",
        },
      },
      { status: 503 },
    );
  }

  let password = "";
  try {
    const body = (await request.json()) as { password?: unknown };
    password = typeof body.password === "string" ? body.password : "";
  } catch {
    // ignore malformed body
  }

  if (password !== expected) {
    // 轻微延迟，降低暴力尝试速度
    await new Promise((resolve) => setTimeout(resolve, 400));
    return NextResponse.json(
      { error: { code: "INVALID_PASSWORD", message: "访问密码不正确。" } },
      { status: 401 },
    );
  }

  const response = NextResponse.json({ ok: true });
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const secure = forwardedProto
    ? forwardedProto.split(",")[0].trim() === "https"
    : new URL(request.url).protocol === "https:";

  response.cookies.set(AUTH_COOKIE, await authToken(expected), {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return response;
}
