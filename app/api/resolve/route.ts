import { NextResponse } from "next/server";
import { AppError } from "@/lib/errors";
import { isConfigured, resolveLink, toAppError } from "@/lib/tg";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const SETUP_MESSAGE =
  "服务端尚未配置 Telegram 会话。请设置 TG_API_ID、TG_API_HASH、TG_SESSION 后重新部署。";

export async function POST(request: Request) {
  if (!isConfigured()) {
    return NextResponse.json(
      { error: { code: "NOT_CONFIGURED", message: SETUP_MESSAGE } },
      { status: 503 },
    );
  }

  let url = "";
  try {
    const body = (await request.json()) as { url?: unknown };
    url = typeof body.url === "string" ? body.url.trim() : "";
  } catch {
    return NextResponse.json(
      { error: { code: "BAD_LINK", message: "请求格式不正确。" } },
      { status: 400 },
    );
  }

  if (!url) {
    return NextResponse.json(
      { error: { code: "BAD_LINK", message: "请先粘贴 Telegram 链接。" } },
      { status: 400 },
    );
  }

  try {
    const data = await resolveLink(url);
    return NextResponse.json(data, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const appError = error instanceof AppError ? error : toAppError(error);
    return NextResponse.json(
      { error: { code: appError.code, message: appError.message } },
      { status: appError.status },
    );
  }
}
