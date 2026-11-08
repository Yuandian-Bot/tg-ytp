import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE, authToken } from "@/lib/auth-token";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (!pathname.startsWith("/api/") || pathname === "/api/auth") {
    return NextResponse.next();
  }

  const password = process.env.APP_PASSWORD;
  // 未设置密码时不在这里拦截，由具体接口返回配置缺失提示。
  if (!password) return NextResponse.next();

  const expected = await authToken(password);
  const cookieToken = request.cookies.get(AUTH_COOKIE)?.value;
  const urlToken = request.nextUrl.searchParams.get("token");
  if (cookieToken !== expected && urlToken !== expected) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "需要访问密码。" } },
      { status: 401 },
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: "/api/:path*",
};
