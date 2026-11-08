export type MediaKind = "video" | "photo" | "audio" | "document";
export type PeerType = "channel" | "chat" | "user";

export interface Variant {
  /** 下载接口使用的稳定标识，例如 f:123 或 p:123:x */
  key: string;
  /** 展示用的清晰度/尺寸标签 */
  label: string;
  size: number;
  width?: number;
  height?: number;
}

export interface MediaGroup {
  messageId: number;
  kind: MediaKind;
  title: string;
  mimeType: string;
  /** 默认（最高画质）文件大小 */
  size: number;
  duration?: number;
  width?: number;
  height?: number;
  /** 内联的 JPEG data URL 缩略图 */
  thumb: string | null;
  variants: Variant[];
}

export interface ResolveResult {
  chat: {
    title: string;
    username?: string;
    /** 原始频道/群组 ID（不含 -100 前缀） */
    id: string;
    accessHash: string;
    type: PeerType;
  };
  message: {
    id: number;
    date: number;
    text: string;
  };
  items: MediaGroup[];
}
