import bigInt from "big-integer";
import { Api, TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import { AppError } from "./errors";
import type { MediaGroup, MediaKind, PeerType, ResolveResult, Variant } from "./types";

const DIALOG_SCAN_LIMIT = 500;
const MAX_THUMBS = 10;
const THUMB_PARALLEL = 4;
const MAX_THUMB_BYTES = 160 * 1024;

type AnyChat = Api.Channel | Api.Chat | Api.User;
type PhotoSizeInfo = { type: string; width: number; height: number; size: number };

const MIME_EXT: Record<string, string> = {
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "video/x-matroska": "mkv",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/heic": "heic",
  "audio/mpeg": "mp3",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/flac": "flac",
  "audio/wav": "wav",
  "application/pdf": "pdf",
  "application/zip": "zip",
  "application/x-rar-compressed": "rar",
  "application/x-7z-compressed": "7z",
  "application/vnd.android.package-archive": "apk",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "text/plain": "txt",
  "application/json": "json",
};

export function isConfigured(): boolean {
  return Boolean(process.env.TG_API_ID && process.env.TG_API_HASH && process.env.TG_SESSION);
}

let clientPromise: Promise<TelegramClient> | null = null;
const channelCache = new Map<string, Api.Channel>();

export async function getClient(): Promise<TelegramClient> {
  if (!isConfigured()) {
    throw new AppError(
      "NOT_CONFIGURED",
      "服务端尚未配置 Telegram 会话，请设置 TG_API_ID、TG_API_HASH、TG_SESSION 环境变量。",
      503,
    );
  }

  if (!clientPromise) {
    const apiId = Number(process.env.TG_API_ID);
    if (!Number.isFinite(apiId) || apiId <= 0) {
      throw new AppError("NOT_CONFIGURED", "TG_API_ID 格式不正确。", 503);
    }
    const client = new TelegramClient(
      new StringSession(process.env.TG_SESSION!.trim()),
      apiId,
      process.env.TG_API_HASH!.trim(),
      {
        connectionRetries: 3,
        autoReconnect: true,
        retryDelay: 1000,
        timeout: 20,
      },
    );
    clientPromise = client
      .connect()
      .then(() => client)
      .catch((error) => {
        clientPromise = null;
        throw error;
      });
  }

  return clientPromise;
}

/* ------------------------------------------------------------------ */
/* 链接解析                                                            */
/* ------------------------------------------------------------------ */

export type ParsedLink =
  | { kind: "public"; username: string; msgId?: number }
  | { kind: "private"; channelId: string; msgId?: number }
  | { kind: "invite"; hash: string };

export function parseLink(raw: string): ParsedLink {
  let input = raw.trim();
  if (!input) throw new AppError("BAD_LINK", "请先粘贴 Telegram 链接。");

  if (input.startsWith("@")) input = `https://t.me/${input.slice(1)}`;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(input)) input = `https://${input}`;

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new AppError("BAD_LINK", "链接格式不正确。");
  }

  if (url.protocol === "tg:") {
    if (url.hostname !== "resolve") {
      throw new AppError("BAD_LINK", "仅支持 tg://resolve 形式的链接。");
    }
    const domain = url.searchParams.get("domain");
    const post = url.searchParams.get("post");
    if (!domain) throw new AppError("BAD_LINK", "链接中缺少频道用户名。");
    const msgId = post ? parseMsgId(post) : undefined;
    return { kind: "public", username: domain.replace(/^@/, ""), msgId };
  }

  const host = url.hostname.replace(/^www\./i, "").toLowerCase();
  if (!["t.me", "telegram.me", "telegram.dog"].includes(host)) {
    throw new AppError("BAD_LINK", "请粘贴 t.me 的 Telegram 链接。");
  }

  const parts = url.pathname.split("/").filter(Boolean).map((p) => decodeURIComponent(p));
  if (parts[0] === "s") parts.shift();
  if (!parts.length) throw new AppError("BAD_LINK", "链接中缺少频道信息。");

  const first = parts[0];

  if (first === "c") {
    const channelId = parts[1] ?? "";
    if (!/^\d+$/.test(channelId)) {
      throw new AppError("BAD_LINK", "私有频道链接格式应为 t.me/c/频道ID/消息ID。");
    }
    return { kind: "private", channelId, msgId: parts[2] ? parseMsgId(parts[2]) : undefined };
  }

  if (first === "joinchat") {
    const hash = parts[1];
    if (!hash) throw new AppError("BAD_LINK", "邀请链接缺少邀请码。");
    return { kind: "invite", hash };
  }

  if (first.startsWith("+")) {
    return { kind: "invite", hash: first.slice(1) };
  }

  if (!/^[A-Za-z0-9_]{3,64}$/.test(first)) {
    throw new AppError("BAD_LINK", "无法识别的频道用户名。");
  }

  return { kind: "public", username: first, msgId: parts[1] ? parseMsgId(parts[1]) : undefined };
}

function parseMsgId(value: string): number {
  if (!/^\d+$/.test(value)) throw new AppError("BAD_LINK", "消息 ID 必须是数字。");
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new AppError("BAD_LINK", "消息 ID 不正确。");
  return id;
}

/* ------------------------------------------------------------------ */
/* 实体解析                                                            */
/* ------------------------------------------------------------------ */

function peerMeta(entity: AnyChat) {
  if (entity instanceof Api.Channel) {
    return {
      type: "channel" as PeerType,
      id: entity.id.toString(),
      accessHash: entity.accessHash?.toString() ?? "0",
      title: entity.title || "未命名频道",
      username: entity.username || undefined,
    };
  }
  if (entity instanceof Api.Chat) {
    return {
      type: "chat" as PeerType,
      id: entity.id.toString(),
      accessHash: "0",
      title: entity.title || "未命名群组",
      username: undefined,
    };
  }
  return {
    type: "user" as PeerType,
    id: entity.id.toString(),
    accessHash: entity.accessHash?.toString() ?? "0",
    title: [entity.firstName, entity.lastName].filter(Boolean).join(" ") || entity.username || "用户",
    username: entity.username || undefined,
  };
}

async function resolveEntity(
  client: TelegramClient,
  parsed: ParsedLink,
): Promise<AnyChat> {
  if (parsed.kind === "public") {
    const entity = await client.getEntity(parsed.username);
    return entity as AnyChat;
  }

  if (parsed.kind === "private") {
    const cached = channelCache.get(parsed.channelId);
    if (cached) return cached;

    const dialogs = await client.getDialogs({ limit: DIALOG_SCAN_LIMIT });
    for (const dialog of dialogs) {
      const entity = dialog.entity;
      if (entity instanceof Api.Channel && entity.id.toString() === parsed.channelId) {
        channelCache.set(parsed.channelId, entity);
        return entity;
      }
    }

    throw new AppError(
      "NOT_FOUND",
      "找不到该私有频道。私有频道无法绕过权限：请确认当前 TG_SESSION 对应的账号已经加入该频道，然后重试。",
      404,
    );
  }

  const info = await client.invoke(new Api.messages.CheckChatInvite({ hash: parsed.hash }));
  if (info instanceof Api.ChatInviteAlready) {
    return info.chat as AnyChat;
  }

  let title = "该频道";
  if (info instanceof Api.ChatInvite) {
    title = info.title;
  } else if (info instanceof Api.ChatInvitePeek) {
    const chat = info.chat;
    if (chat instanceof Api.Channel || chat instanceof Api.Chat) title = chat.title;
  }
  throw new AppError(
    "JOIN_REQUIRED",
    `「${title}」需要先用你的 Telegram 账号加入。加入后请使用 t.me/c/... 形式的链接，或重新解析。`,
    403,
  );
}

/* ------------------------------------------------------------------ */
/* 媒体信息                                                            */
/* ------------------------------------------------------------------ */

function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (value === null || value === undefined) return 0;
  const n = Number(String(value));
  return Number.isFinite(n) ? n : 0;
}

function getPhotoSizes(photo: Api.Photo): PhotoSizeInfo[] {
  const out: PhotoSizeInfo[] = [];
  for (const size of photo.sizes) {
    if (size instanceof Api.PhotoSize) {
      out.push({ type: size.type, width: size.w, height: size.h, size: size.size });
    } else if (size instanceof Api.PhotoSizeProgressive) {
      const last = size.sizes.length ? size.sizes[size.sizes.length - 1] : 0;
      out.push({ type: size.type, width: size.w, height: size.h, size: last });
    }
  }
  return out
    .filter((s) => s.size > 0 && s.width > 0 && s.height > 0)
    .sort((a, b) => b.width * b.height - a.width * a.height);
}

function getThumbSizes(thumbs: Api.TypePhotoSize[] | undefined): PhotoSizeInfo[] {
  const out: PhotoSizeInfo[] = [];
  for (const size of thumbs ?? []) {
    if (size instanceof Api.PhotoSize) {
      out.push({ type: size.type, width: size.w, height: size.h, size: size.size });
    } else if (size instanceof Api.PhotoSizeProgressive) {
      const last = size.sizes.length ? size.sizes[size.sizes.length - 1] : 0;
      out.push({ type: size.type, width: size.w, height: size.h, size: last });
    }
  }
  return out.filter((s) => s.width > 0 && s.type).sort((a, b) => a.width - b.width);
}

function hasMedia(message: Api.Message): boolean {
  return (
    message.media != null &&
    !(message.media instanceof Api.MessageMediaEmpty) &&
    !(message.media instanceof Api.MessageMediaWebPage)
  );
}

function downloadKind(message: Api.Message): MediaKind | null {
  const media = message.media;
  if (media instanceof Api.MessageMediaPhoto && media.photo instanceof Api.Photo) return "photo";
  if (media instanceof Api.MessageMediaDocument && media.document instanceof Api.Document) {
    const doc = media.document;
    const hasVideo = doc.attributes.some((a) => a instanceof Api.DocumentAttributeVideo);
    const hasAudio = doc.attributes.some((a) => a instanceof Api.DocumentAttributeAudio);
    if (hasVideo) return "video";
    if (hasAudio) return "audio";
    return "document";
  }
  return null;
}

function buildGroup(message: Api.Message): MediaGroup | null {
  const media = message.media;

  if (media instanceof Api.MessageMediaPhoto && media.photo instanceof Api.Photo) {
    const sizes = getPhotoSizes(media.photo);
    if (!sizes.length) return null;
    const variants: Variant[] = sizes.map((size) => ({
      key: `p:${message.id}:${size.type}`,
      label: `${size.width}×${size.height}`,
      size: size.size,
      width: size.width,
      height: size.height,
    }));
    const largest = variants[0];
    return {
      messageId: message.id,
      kind: "photo",
      title: `photo-${message.id}.jpg`,
      mimeType: "image/jpeg",
      size: largest.size,
      width: largest.width,
      height: largest.height,
      thumb: null,
      variants,
    };
  }

  if (media instanceof Api.MessageMediaDocument && media.document instanceof Api.Document) {
    const doc = media.document;
    const video = doc.attributes.find(
      (a): a is Api.DocumentAttributeVideo => a instanceof Api.DocumentAttributeVideo,
    );
    const audio = doc.attributes.find(
      (a): a is Api.DocumentAttributeAudio => a instanceof Api.DocumentAttributeAudio,
    );
    const file = doc.attributes.find(
      (a): a is Api.DocumentAttributeFilename => a instanceof Api.DocumentAttributeFilename,
    );

    const kind: MediaKind = video ? "video" : audio ? "audio" : "document";
    const size = toNumber(doc.size);
    const mimeType = doc.mimeType || "application/octet-stream";
    const baseName = kind === "video" ? `video-${message.id}.mp4` : file?.fileName || `file-${message.id}`;
    const title = ensureExtension(baseName, mimeType);
    const variant: Variant = {
      key: `f:${message.id}`,
      label: video ? `${video.w}×${video.h}` : kind === "audio" ? "音频" : "原始文件",
      size,
      width: video?.w,
      height: video?.h,
    };

    return {
      messageId: message.id,
      kind,
      title,
      mimeType,
      size,
      duration: video?.duration || audio?.duration || undefined,
      width: video?.w,
      height: video?.h,
      thumb: null,
      variants: [variant],
    };
  }

  return null;
}

function ensureExtension(name: string, mimeType: string): string {
  if (/\.[A-Za-z0-9]{1,10}$/.test(name)) return name;
  const ext = MIME_EXT[mimeType.split(";")[0].trim().toLowerCase()];
  return ext ? `${name}.${ext}` : name;
}

function sanitizeName(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
  const safe = cleaned || "download";
  return safe.length > 140 ? safe.slice(0, 140) : safe;
}

/* ------------------------------------------------------------------ */
/* 缩略图                                                              */
/* ------------------------------------------------------------------ */

async function loadThumb(
  client: TelegramClient,
  location: Api.TypeInputFileLocation,
  dcId: number,
): Promise<string | null> {
  try {
    const result = await client.downloadFile(location, { dcId });
    if (!result || typeof result === "string") return null;
    if (result.length > MAX_THUMB_BYTES) return null;
    return `data:image/jpeg;base64,${result.toString("base64")}`;
  } catch {
    return null;
  }
}

async function attachThumb(client: TelegramClient, message: Api.Message, group: MediaGroup) {
  const media = message.media;

  if (media instanceof Api.MessageMediaPhoto && media.photo instanceof Api.Photo) {
    const sizes = getPhotoSizes(media.photo).slice().reverse();
    const pick = sizes.find((s) => s.width >= 120) ?? sizes[0];
    if (!pick) return null;
    const location = new Api.InputPhotoFileLocation({
      id: media.photo.id,
      accessHash: media.photo.accessHash,
      fileReference: media.photo.fileReference,
      thumbSize: pick.type,
    });
    return loadThumb(client, location, media.photo.dcId);
  }

  if (media instanceof Api.MessageMediaDocument && media.document instanceof Api.Document) {
    const doc = media.document;
    const thumbs = getThumbSizes(doc.thumbs);
    const pick = thumbs.find((s) => s.width >= 80) ?? thumbs[0];
    if (!pick) return null;
    const location = new Api.InputDocumentFileLocation({
      id: doc.id,
      accessHash: doc.accessHash,
      fileReference: doc.fileReference,
      thumbSize: pick.type,
    });
    return loadThumb(client, location, doc.dcId);
  }

  return null;
}

async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      await fn(items[index]);
    }
  });
  await Promise.all(workers);
}

/* ------------------------------------------------------------------ */
/* 对外：解析链接                                                      */
/* ------------------------------------------------------------------ */

export async function resolveLink(raw: string): Promise<ResolveResult> {
  const parsed = parseLink(raw);
  const client = await getClient();

  try {
    const entity = await resolveEntity(client, parsed);

    let msgId = parsed.kind === "invite" ? undefined : parsed.msgId;
    if (!msgId) {
      const latest = await client.getMessages(entity, { limit: 20 });
      const candidate = latest.find((m) => m instanceof Api.Message && hasMedia(m));
      if (!candidate) {
        throw new AppError(
          "NO_MEDIA",
          "最近 20 条消息里没有可下载的媒体，请在链接末尾加上具体的消息 ID。",
          404,
        );
      }
      msgId = candidate.id;
    }

    const ids: number[] = [];
    for (let id = Math.max(1, msgId - 9); id <= msgId + 9; id += 1) ids.push(id);

    const fetched = await client.getMessages(entity, { ids });
    const messages = fetched.filter((m): m is Api.Message => m instanceof Api.Message);
    const target = messages.find((m) => m.id === msgId);

    if (!target) throw new AppError("NOT_FOUND", "消息不存在或已被删除。", 404);

    let groupMessages = [target];
    if (target.groupedId) {
      const album = messages
        .filter(
          (m) =>
            m.groupedId != null &&
            String(m.groupedId) === String(target.groupedId) &&
            hasMedia(m),
        )
        .sort((a, b) => a.id - b.id);
      if (album.length) groupMessages = album;
    }

    const byId = new Map<number, Api.Message>();
    const items: MediaGroup[] = [];
    for (const message of groupMessages) {
      byId.set(message.id, message);
      const group = buildGroup(message);
      if (group) items.push(group);
    }

    if (!items.length) {
      throw new AppError("NO_MEDIA", "这条消息不包含可下载的媒体。", 404);
    }

    await mapLimit(items.slice(0, MAX_THUMBS), THUMB_PARALLEL, async (group) => {
      const message = byId.get(group.messageId);
      if (message) group.thumb = await attachThumb(client, message, group);
    });

    return {
      chat: peerMeta(entity),
      message: {
        id: target.id,
        date: target.date,
        text: (target.message || "").slice(0, 500),
      },
      items,
    };
  } catch (error) {
    throw toAppError(error);
  }
}

/* ------------------------------------------------------------------ */
/* 对外：下载                                                          */
/* ------------------------------------------------------------------ */

export interface FileRequest {
  peerType: PeerType;
  peerId: string;
  accessHash: string;
  msgId: number;
  key: string;
  name?: string;
}

export interface OpenFileResult {
  client: TelegramClient;
  location: Api.TypeInputFileLocation;
  size: number;
  mimeType: string;
  fileName: string;
  dcId: number;
}

function buildPeer(request: FileRequest): Api.TypeInputPeer {
  if (!/^\d+$/.test(request.peerId)) {
    throw new AppError("BAD_REQUEST", "无效的频道参数。", 400);
  }

  try {
    if (request.peerType === "channel") {
      return new Api.InputPeerChannel({
        channelId: bigInt(request.peerId),
        accessHash: bigInt(request.accessHash || "0"),
      });
    }
    if (request.peerType === "chat") {
      return new Api.InputPeerChat({ chatId: bigInt(request.peerId) });
    }
    if (request.peerType === "user") {
      return new Api.InputPeerUser({
        userId: bigInt(request.peerId),
        accessHash: bigInt(request.accessHash || "0"),
      });
    }
  } catch {
    throw new AppError("BAD_REQUEST", "无效的频道参数。", 400);
  }

  throw new AppError("BAD_REQUEST", "无效的会话类型。", 400);
}

export async function openFile(request: FileRequest): Promise<OpenFileResult> {
  const client = await getClient();
  const peer = buildPeer(request);

  let message: Api.Message | undefined;
  try {
    const messages = await client.getMessages(peer, { ids: [request.msgId] });
    message = messages.find(
      (m): m is Api.Message => m instanceof Api.Message && m.id === request.msgId,
    );
  } catch (error) {
    throw toAppError(error);
  }

  if (!message) throw new AppError("NOT_FOUND", "消息不存在或已被删除。", 404);

  const media = message.media;
  const [prefix, msgIdRaw, sizeType] = request.key.split(":");

  if (prefix === "p") {
    if (Number(msgIdRaw) !== message.id) {
      throw new AppError("BAD_REQUEST", "文件参数不匹配。", 400);
    }
    if (!(media instanceof Api.MessageMediaPhoto) || !(media.photo instanceof Api.Photo)) {
      throw new AppError("NOT_FOUND", "该消息不是图片。", 404);
    }
    const photo = media.photo;
    const size = getPhotoSizes(photo).find((s) => s.type === sizeType);
    if (!size) throw new AppError("NOT_FOUND", "该图片尺寸不存在。", 404);

    return {
      client,
      location: new Api.InputPhotoFileLocation({
        id: photo.id,
        accessHash: photo.accessHash,
        fileReference: photo.fileReference,
        thumbSize: size.type,
      }),
      size: size.size,
      mimeType: "image/jpeg",
      fileName: sanitizeName(
        request.name || `photo-${message.id}-${size.width}x${size.height}.jpg`,
      ),
      dcId: photo.dcId,
    };
  }

  if (prefix === "f") {
    if (Number(msgIdRaw) !== message.id) {
      throw new AppError("BAD_REQUEST", "文件参数不匹配。", 400);
    }
    if (!(media instanceof Api.MessageMediaDocument) || !(media.document instanceof Api.Document)) {
      throw new AppError("NOT_FOUND", "该消息不包含文件。", 404);
    }
    const doc = media.document;
    const fileAttribute = doc.attributes.find(
      (a): a is Api.DocumentAttributeFilename => a instanceof Api.DocumentAttributeFilename,
    );
    const mimeType = doc.mimeType || "application/octet-stream";
    const baseName = request.name || fileAttribute?.fileName || `file-${message.id}`;

    return {
      client,
      location: new Api.InputDocumentFileLocation({
        id: doc.id,
        accessHash: doc.accessHash,
        fileReference: doc.fileReference,
        thumbSize: "",
      }),
      size: toNumber(doc.size),
      mimeType,
      fileName: sanitizeName(ensureExtension(baseName, mimeType)),
      dcId: doc.dcId,
    };
  }

  throw new AppError("BAD_REQUEST", "无效的文件标识。", 400);
}

/* ------------------------------------------------------------------ */
/* 错误转换                                                            */
/* ------------------------------------------------------------------ */

export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;

  const raw = error as { errorMessage?: string; message?: string } | null;
  const code = raw?.errorMessage || raw?.message || "UNKNOWN";

  if (/^FLOOD_WAIT_\d+$/i.test(code)) {
    const seconds = Number(code.split("_").pop());
    return new AppError(
      "FLOOD_WAIT",
      `请求过于频繁，Telegram 要求等待 ${seconds} 秒后再试。`,
      429,
    );
  }

  switch (code) {
    case "CHANNEL_PRIVATE":
      return new AppError("CHANNEL_PRIVATE", "该频道为私有频道，请确认你的账号已经加入。", 403);
    case "CHANNEL_INVALID":
    case "PEER_ID_INVALID":
      return new AppError("CHANNEL_INVALID", "无法定位该频道，请检查链接或确认账号已加入。", 404);
    case "CHANNEL_ADMIN_REQUIRED":
      return new AppError("CHANNEL_ADMIN_REQUIRED", "当前账号没有权限访问该频道内容。", 403);
    case "USERNAME_NOT_OCCUPIED":
    case "USERNAME_INVALID":
      return new AppError("NOT_FOUND", "频道不存在，或用户名已更改。", 404);
    case "MESSAGE_ID_INVALID":
      return new AppError("NOT_FOUND", "消息不存在或已被删除。", 404);
    case "MEDIA_EMPTY":
      return new AppError("NO_MEDIA", "这条消息不包含可下载的媒体。", 404);
    case "AUTH_KEY_UNREGISTERED":
    case "SESSION_REVOKED":
    case "USER_DEACTIVATED_BAN":
    case "AUTH_KEY_INVALID":
      return new AppError(
        "SESSION_INVALID",
        "Telegram 会话已失效，请重新运行 npm run login 生成 TG_SESSION。",
        401,
      );
    case "FILE_REFERENCE_EXPIRED":
    case "FILE_REFERENCE_INVALID":
      return new AppError("FILE_EXPIRED", "文件引用已过期，请重新解析链接。", 410);
    default:
      break;
  }

  const message = raw?.message || String(error);
  if (/ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|TIMEOUT|socket|network/i.test(message)) {
    return new AppError("NETWORK", "连接 Telegram 失败，请稍后重试。", 502);
  }

  return new AppError("UNKNOWN", `操作失败：${message.slice(0, 180)}`, 500);
}
