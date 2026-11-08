import bigInt from "big-integer";
import { NextRequest, NextResponse } from "next/server";
import { AppError } from "@/lib/errors";
import { isConfigured, openFile, toAppError } from "@/lib/tg";
import type { PeerType } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const CHUNK = 512 * 1024;
const ALIGN = 4096;
const DEFAULT_CONCURRENCY = 6;
const MAX_PART_BUFFER = 16 * 1024 * 1024; // 每个分片最多缓冲 16MB，避免内存爆掉

interface Part {
  id: number;
  start: number;
  end: number;
  alignedStart: number;
  skip: number;
  iterator: AsyncIterator<Buffer>;
  buffer: Uint8Array[];
  bufferedBytes: number;
  done: boolean;
  error: unknown | null;
  fetching: boolean;
  waiters: Array<() => void>;
}

function jsonError(error: unknown) {
  const appError = error instanceof AppError ? error : toAppError(error);
  return NextResponse.json(
    { error: { code: appError.code, message: appError.message } },
    { status: appError.status },
  );
}

function contentDisposition(fileName: string): string {
  const fallback = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

function getConcurrency(request: NextRequest): number {
  const raw = request.nextUrl.searchParams.get("c");
  const parsed = raw ? Number(raw) : NaN;
  if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 16) return Math.floor(parsed);
  return DEFAULT_CONCURRENCY;
}

function splitRange(start: number, end: number, count: number): Array<{ start: number; end: number }> {
  const total = end - start + 1;
  if (total <= 0) return [];
  const partSize = Math.ceil(total / count);
  const parts: Array<{ start: number; end: number }> = [];
  for (let i = 0; i < count; i++) {
    const pStart = start + i * partSize;
    if (pStart > end) break;
    const pEnd = Math.min(end, pStart + partSize - 1);
    parts.push({ start: pStart, end: pEnd });
  }
  return parts;
}

export async function GET(request: NextRequest) {
  if (!isConfigured()) {
    return NextResponse.json(
      {
        error: {
          code: "NOT_CONFIGURED",
          message: "服务端尚未配置 Telegram 会话。",
        },
      },
      { status: 503 },
    );
  }

  const params = request.nextUrl.searchParams;
  const peerType = params.get("pt") as PeerType | null;
  const peerId = params.get("pid") || "";
  const accessHash = params.get("ah") || "";
  const msgId = Number(params.get("m"));
  const key = params.get("k") || "";
  const name = params.get("n") || undefined;

  if (
    !peerType ||
    !["channel", "chat", "user"].includes(peerType) ||
    !peerId ||
    !key ||
    !Number.isSafeInteger(msgId) ||
    msgId <= 0
  ) {
    return NextResponse.json(
      { error: { code: "BAD_REQUEST", message: "下载参数不完整。" } },
      { status: 400 },
    );
  }

  let file;
  try {
    file = await openFile({ peerType, peerId, accessHash, msgId, key, name });
  } catch (error) {
    return jsonError(error);
  }

  const size = file.size;
  if (!Number.isFinite(size) || size <= 0) {
    return NextResponse.json(
      { error: { code: "BAD_FILE", message: "无法读取文件大小，请重新解析。" } },
      { status: 502 },
    );
  }

  let start = 0;
  let end = size - 1;
  let status = 200;
  const rangeHeader = request.headers.get("range");

  if (rangeHeader) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
    if (match) {
      const [, startRaw, endRaw] = match;
      if (!startRaw && endRaw) {
        const suffix = Number(endRaw);
        start = Math.max(0, size - suffix);
        end = size - 1;
      } else if (startRaw) {
        start = Number(startRaw);
        end = endRaw ? Number(endRaw) : size - 1;
      }

      if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) {
        return new Response(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${size}` },
        });
      }

      end = Math.min(end, size - 1);
      status = 206;
    }
  }

  const length = end - start + 1;
  const concurrency = Math.min(getConcurrency(request), Math.max(1, Math.ceil(length / CHUNK)));
  const ranges = splitRange(start, end, concurrency);

  const parts: Part[] = ranges.map((r, i) => {
    const alignedStart = Math.floor(r.start / ALIGN) * ALIGN;
    const skip = r.start - alignedStart;
    const iterator = file.client
      .iterDownload({
        file: file.location,
        offset: bigInt(alignedStart),
        requestSize: CHUNK,
        chunkSize: CHUNK,
        fileSize: bigInt(size),
        dcId: file.dcId,
      })
      [Symbol.asyncIterator]() as AsyncIterator<Buffer>;

    return {
      id: i,
      start: r.start,
      end: r.end,
      alignedStart,
      skip,
      iterator,
      buffer: [],
      bufferedBytes: 0,
      done: false,
      error: null,
      fetching: false,
      waiters: [],
    };
  });

  let partIndex = 0;
  let closed = false;

  const notify = (part: Part) => {
    const ws = part.waiters;
    part.waiters = [];
    ws.forEach((w) => w());
  };

  const fetchPart = async (part: Part) => {
    if (part.fetching || part.done || part.error) return;
    part.fetching = true;
    try {
      while (!part.done && part.bufferedBytes < MAX_PART_BUFFER && !part.error) {
        const { value, done } = await part.iterator.next();
        if (done) {
          part.done = true;
          break;
        }
        let chunk = value as Buffer;
        if (!chunk || chunk.length === 0) {
          part.done = true;
          break;
        }
        if (part.skip > 0) {
          if (chunk.length <= part.skip) {
            part.skip -= chunk.length;
            continue;
          }
          chunk = chunk.subarray(part.skip);
          part.skip = 0;
        }
        const partLen = part.end - part.start + 1;
        const produced = part.bufferedBytes;
        if (produced + chunk.length > partLen) {
          chunk = chunk.subarray(0, partLen - produced);
        }
        if (chunk.length > 0) {
          part.buffer.push(new Uint8Array(chunk));
          part.bufferedBytes += chunk.length;
        }
        if (part.bufferedBytes >= partLen) {
          part.done = true;
          break;
        }
      }
    } catch (err) {
      part.error = err;
    } finally {
      part.fetching = false;
      notify(part);
    }
  };

  const ensureAhead = () => {
    // 让当前输出分片 + 后面几个分片同时下载，形成并发流水线
    const windowEnd = Math.min(parts.length, partIndex + concurrency);
    for (let i = partIndex; i < windowEnd; i++) {
      const p = parts[i];
      if (!p.done && !p.error && !p.fetching && p.bufferedBytes < MAX_PART_BUFFER) {
        fetchPart(p);
      }
    }
  };

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        while (partIndex < parts.length) {
          const part = parts[partIndex];
          if (part.error) {
            controller.error(part.error);
            return;
          }
          if (part.buffer.length > 0) {
            const chunk = part.buffer.shift()!;
            part.bufferedBytes -= chunk.length;
            controller.enqueue(chunk);
            ensureAhead();
            return;
          }
          if (part.done) {
            partIndex++;
            continue;
          }
          ensureAhead();
          await new Promise<void>((resolve) => part.waiters.push(resolve));
        }
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel() {
      closed = true;
      for (const part of parts) {
        try {
          await part.iterator.return?.(undefined);
        } catch {
          /* ignore */
        }
      }
    },
  });

  const headers = new Headers({
    "Content-Type": file.mimeType || "application/octet-stream",
    "Content-Length": String(length),
    "Content-Disposition": contentDisposition(file.fileName),
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-store",
  });

  if (status === 206) {
    headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
  }

  return new Response(stream, { status, headers });
}
