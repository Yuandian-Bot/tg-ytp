"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import type { MediaGroup, MediaKind, ResolveResult } from "@/lib/types";

type ApiError = { code: string; message: string };

const KIND_LABEL: Record<MediaKind, string> = {
  video: "视频",
  photo: "图片",
  audio: "音频",
  document: "文件",
};

const EXAMPLES = ["https://t.me/telegram/1", "t.me/durov/1"];

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "未知大小";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[index]}`;
}

function formatDuration(seconds?: number): string | null {
  if (!seconds || seconds <= 0) return null;
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

function formatDate(unix: number): string {
  return new Date(unix * 1000).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/* ------------------------------------------------------------------ */
/* icons                                                               */
/* ------------------------------------------------------------------ */

function IconPlane() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M21.6 3.2 2.9 10.6c-1 .4-1 1.7 0 2.1l4.5 1.6 1.7 5.4c.2.8 1.2 1 1.8.4l2.5-2.6 4.6 3.4c.7.5 1.7.1 1.9-.7l3-14.4c.2-1-.7-1.8-1.7-1.4Z"
        fill="currentColor"
      />
    </svg>
  );
}

function IconLink() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <path d="M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1.1 1" />
      <path d="M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1.1-1" />
    </svg>
  );
}

function IconSearch() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

function IconDownload() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M4 20h16" />
    </svg>
  );
}

function IconLock() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <rect x="4" y="10" width="16" height="10" rx="2.5" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

function IconAlert() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v6" />
      <path d="M12 16.5h.01" />
    </svg>
  );
}

function IconVideo() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="6" width="13" height="12" rx="2.5" />
      <path d="m16 10 5-3v10l-5-3" />
    </svg>
  );
}

function IconImage() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <circle cx="9" cy="9" r="1.6" />
      <path d="m4 17 5-5 4 4 3-2.5 4 3.5" />
    </svg>
  );
}

function IconMusic() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
      <path d="M9 18V6l10-2v12" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="16" cy="16" r="3" />
    </svg>
  );
}

function IconFile() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h6" />
      <path d="M9 17h4" />
    </svg>
  );
}

function IconPlay() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M8 5.5v13a1 1 0 0 0 1.5.87l10-6.5a1 1 0 0 0 0-1.74l-10-6.5A1 1 0 0 0 8 5.5Z" />
    </svg>
  );
}

function KindIcon({ kind }: { kind: MediaKind }) {
  if (kind === "video") return <IconVideo />;
  if (kind === "photo") return <IconImage />;
  if (kind === "audio") return <IconMusic />;
  return <IconFile />;
}

/* ------------------------------------------------------------------ */
/* media card                                                          */
/* ------------------------------------------------------------------ */

interface MediaCardProps {
  item: MediaGroup;
  chat: ResolveResult["chat"];
  choice: string;
  started: boolean;
  token: string | null;
  onChoose: (messageId: number, key: string) => void;
  onDownload: (messageId: number) => void;
}

function MediaCard({ item, chat, choice, started, token, onChoose, onDownload }: MediaCardProps) {
  const active = item.variants.find((variant) => variant.key === choice) ?? item.variants[0];
  const fileName =
    item.kind === "photo" && active.width && active.height
      ? `photo-${item.messageId}-${active.width}x${active.height}.jpg`
      : item.title;

  const query = new URLSearchParams({
    pt: chat.type,
    pid: chat.id,
    ah: chat.accessHash,
    m: String(item.messageId),
    k: active.key,
    n: fileName,
  });

  const duration = formatDuration(item.duration);

  return (
    <article className="mediaCard">
      <div className={`thumb ${item.kind}`}>
        {item.thumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="thumbImg" src={item.thumb} alt="" loading="lazy" decoding="async" />
        ) : (
          <span className="thumbIcon">
            <KindIcon kind={item.kind} />
          </span>
        )}

        {item.kind === "video" && (
          <span className="playBadge">
            <IconPlay />
          </span>
        )}

        <span className="badge">{KIND_LABEL[item.kind]}</span>
        {duration && <span className="durationBadge">{duration}</span>}
      </div>

      <div className="cardBody">
        <h3 className="fileTitle" title={item.title}>
          {item.title}
        </h3>

        <div className="specs">
          {active.width && active.height && (
            <span className="spec">
              {active.width}×{active.height}
            </span>
          )}
          <span className="spec">{formatBytes(active.size)}</span>
          {item.variants.length > 1 && (
            <span className="spec">{item.variants.length} 种尺寸</span>
          )}
        </div>

        <div className="controls">
          {item.variants.length > 1 && (
            <select
              className="variantSelect"
              value={active.key}
              onChange={(event) => onChoose(item.messageId, event.target.value)}
              aria-label="选择清晰度"
            >
              {item.variants.map((variant) => (
                <option key={variant.key} value={variant.key}>
                  {variant.label} · {formatBytes(variant.size)}
                </option>
              ))}
            </select>
          )}

          <a
            className={`downloadBtn${started ? " isDone" : ""}`}
            href={`/api/file?${query.toString()}`}
            download={fileName}
            onClick={() => onDownload(item.messageId)}
          >
            <IconDownload />
            {started ? "已开始" : "下载"}
          </a>

          <button
            type="button"
            className="copyBtn"
            onClick={async () => {
              const params = new URLSearchParams(query);
              if (token) params.set("token", token);
              const url = `${window.location.origin}/api/file?${params.toString()}`;
              try {
                await navigator.clipboard.writeText(url);
                onDownload(item.messageId);
              } catch {
                const input = document.createElement("textarea");
                input.value = url;
                document.body.appendChild(input);
                input.select();
                document.execCommand("copy");
                document.body.removeChild(input);
                onDownload(item.messageId);
              }
            }}
            title="复制下载链接（可粘贴到 ADM/IDM 等多线程下载工具）"
          >
            <IconLink />
            复制链接
          </button>
        </div>
      </div>
    </article>
  );
}

/* ------------------------------------------------------------------ */
/* page                                                                */
/* ------------------------------------------------------------------ */

export default function Home() {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ResolveResult | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [needPassword, setNeedPassword] = useState(false);
  const [password, setPassword] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState("");
  const [choices, setChoices] = useState<Record<number, string>>({});
  const [started, setStarted] = useState<Record<number, boolean>>({});
  const [token, setToken] = useState<string | null>(null);

  async function fetchToken() {
    try {
      const res = await fetch("/api/auth");
      const data = (await res.json()) as { token?: string | null };
      if (data.token) setToken(data.token);
    } catch {
      // ignore
    }
  }

  async function load(target: string) {
    const value = target.trim();
    if (!value) return;

    setBusy(true);
    setError(null);
    setAuthError("");

    try {
      const response = await fetch("/api/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: value }),
      });

      const payload: unknown = await response.json().catch(() => null);

      if (response.status === 401) {
        setNeedPassword(true);
        setResult(null);
        return;
      }

      if (!response.ok) {
        const apiError = (payload as { error?: ApiError } | null)?.error;
        setError(apiError ?? { code: "UNKNOWN", message: "解析失败，请稍后重试。" });
        setResult(null);
        return;
      }

      const data = payload as ResolveResult;
      const defaults: Record<number, string> = {};
      for (const item of data.items) {
        defaults[item.messageId] = item.variants[0]?.key ?? "";
      }

      setResult(data);
      setChoices(defaults);
      setStarted({});
      setNeedPassword(false);
    } catch {
      setError({ code: "NETWORK", message: "网络请求失败，请检查网络后重试。" });
      setResult(null);
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void load(url);
  }

  async function onLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!password) return;

    setAuthBusy(true);
    setAuthError("");

    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: ApiError }
          | null;
        setAuthError(payload?.error?.message ?? "密码不正确。");
        return;
      }

      setNeedPassword(false);
      setPassword("");
      await fetchToken();
      await load(url);
    } catch {
      setAuthError("网络请求失败，请重试。");
    } finally {
      setAuthBusy(false);
    }
  }

  async function pasteFromClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      if (text) setUrl(text.trim());
    } catch {
      // 浏览器未授权剪贴板时忽略
    }
  }

  function chooseVariant(messageId: number, key: string) {
    setChoices((current) => ({ ...current, [messageId]: key }));
  }

  function markStarted(messageId: number) {
    setStarted((current) => ({ ...current, [messageId]: true }));
    window.setTimeout(() => {
      setStarted((current) => ({ ...current, [messageId]: false }));
    }, 2600);
  }

  const isSetup = error?.code === "NOT_CONFIGURED";
  const isInfo =
    error?.code === "JOIN_REQUIRED" ||
    error?.code === "CHANNEL_PRIVATE" ||
    error?.code === "CHANNEL_INVALID";

  return (
    <div className="shell">
      <header className="siteHeader">
        <div className="brand">
          <span className="brandMark">
            <IconPlane />
          </span>
          <span className="brandText">
            <span className="brandName">TG Grab</span>
            <span className="brandTag">Telegram Media Downloader</span>
          </span>
        </div>
        <span className="headerBadge">
          <span className="dot" />
          Serverless · MTProto
        </span>
      </header>

      <main>
        <section className="hero">
          <span className="eyebrow">
            <span className="dot" />
            私有频道 · 相册 · 原文件
          </span>
          <h1 className="heroTitle">
            粘贴 Telegram 链接，
            <br />
            <em>直接取回原始文件</em>
          </h1>
          <p className="heroSub">
            自动识别视频、图片、文件与整组相册，展示真实分辨率、时长与大小。
            不压缩、不转码，直接从 Telegram 服务器流式下载。
          </p>

          <div className="searchArea">
            <form className="searchCard" onSubmit={onSubmit}>
              <div className="searchField">
                <IconLink />
                <input
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  placeholder="t.me/频道名/消息ID  或  t.me/c/…/…"
                  aria-label="Telegram 链接"
                  autoComplete="off"
                  spellCheck={false}
                  inputMode="url"
                />
              </div>
              <button className="pasteBtn" type="button" onClick={pasteFromClipboard}>
                粘贴
              </button>
              <button className="searchBtn" type="submit" disabled={busy || !url.trim()}>
                {busy ? (
                  <>
                    <span className="spinner" />
                    解析中
                  </>
                ) : (
                  <>
                    <IconSearch />
                    解析链接
                  </>
                )}
              </button>
            </form>

            <div className="hints">
              <span className="hintLabel">示例</span>
              {EXAMPLES.map((example) => (
                <button
                  key={example}
                  className="hintChip"
                  type="button"
                  onClick={() => setUrl(example)}
                >
                  {example.replace("https://", "")}
                </button>
              ))}
              <span className="hintChip hintChipStatic" title="私有频道链接格式">
                t.me/c/频道ID/消息ID
              </span>
            </div>

            <p className="privacyLine">
              <IconLock />
              私有频道需要你的账号已加入；秘密聊天无法被任何第三方下载。
            </p>
          </div>
        </section>

        {busy && (
          <div className="skeletonGrid" aria-hidden="true">
            <div className="skeletonCard" />
            <div className="skeletonCard" />
            <div className="skeletonCard" />
          </div>
        )}

        {needPassword && (
          <section className="authPanel">
            <span className="authIcon">
              <IconLock />
            </span>
            <h2>需要访问密码</h2>
            <p>
              本站使用你的 Telegram 会话下载文件。为防止他人滥用，请先输入部署时设置的
              <code> APP_PASSWORD</code>。
            </p>
            <form className="authForm" onSubmit={onLogin}>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="访问密码"
                aria-label="访问密码"
                autoFocus
              />
              <button type="submit" disabled={authBusy || !password}>
                {authBusy ? "验证中" : "进入"}
              </button>
            </form>
            {authError && <p className="authError">{authError}</p>}
          </section>
        )}

        {!needPassword && isSetup && (
          <section className="setupPanel">
            <div className="setupHead">
              <IconAlert />
              <div>
                <h2>还差 3 步就能使用</h2>
                <p>
                  在 Vercel 项目的 Settings → Environment Variables 中配置以下变量，然后重新部署。
                </p>
              </div>
            </div>
            <ol className="setupList">
              <li>
                <span className="stepNum">1</span>
                <div>
                  <h3>获取 Telegram API 凭证</h3>
                  <p>
                    打开 <code>my.telegram.org</code> → API development tools 创建应用，取得
                    <code>TG_API_ID</code> 与 <code>TG_API_HASH</code>。
                  </p>
                </div>
              </li>
              <li>
                <span className="stepNum">2</span>
                <div>
                  <h3>生成登录会话</h3>
                  <p>
                    在本地项目里运行 <code>npm run login</code>，按提示输入手机号、验证码，
                    得到 <code>TG_SESSION</code>。这串内容等同于账号凭证，切勿公开。
                  </p>
                </div>
              </li>
              <li>
                <span className="stepNum">3</span>
                <div>
                  <h3>设置访问密码</h3>
                  <p>
                    添加 <code>APP_PASSWORD</code>，防止他人使用你的会话。
                    然后在 Vercel 重新部署即可。
                  </p>
                </div>
              </li>
            </ol>
          </section>
        )}

        {!needPassword && error && !isSetup && (
          <div className={`alert${isInfo ? " alertInfo" : ""}`} role="alert">
            {isInfo ? <IconLock /> : <IconAlert />}
            <div>
              <h3>{isInfo ? "需要先加入该频道" : "没有解析成功"}</h3>
              <p>{error.message}</p>
            </div>
          </div>
        )}

        {!needPassword && !busy && result && (
          <section className="panel" aria-live="polite">
            <div className="panelHead">
              <span className="panelAvatar">
                {Array.from(result.chat.title)[0]?.toUpperCase() ?? "T"}
              </span>
              <div className="panelInfo">
                <h2 className="panelTitle" title={result.chat.title}>
                  {result.chat.title}
                </h2>
                <div className="panelMeta">
                  <span>
                    {result.chat.username
                      ? `@${result.chat.username}`
                      : result.chat.type === "channel"
                        ? "私有频道"
                        : result.chat.type === "chat"
                          ? "群组"
                          : "私聊"}
                  </span>
                  <span className="sep">/</span>
                  <span>MSG #{result.message.id}</span>
                  <span className="sep">/</span>
                  <span>{formatDate(result.message.date)}</span>
                </div>
              </div>
              <span className="panelCount">{result.items.length} 个文件</span>
            </div>

            {result.message.text && <p className="caption">{result.message.text}</p>}

            <div className="mediaGrid">
              {result.items.map((item) => (
                <MediaCard
                  key={`${item.messageId}-${item.kind}`}
                  item={item}
                  chat={result.chat}
                  choice={choices[item.messageId] ?? item.variants[0]?.key ?? ""}
                  started={Boolean(started[item.messageId])}
                  token={token}
                  onChoose={chooseVariant}
                  onDownload={markStarted}
                />
              ))}
            </div>

            <p className="panelNote">
              清晰度由上传者提供的源文件决定，Telegram 不保存多档转码；同一帖子含多个版本时会全部列出。
              照片可切换不同尺寸。若浏览器直接打开而非下载，请使用下载按钮。
            </p>
          </section>
        )}

        <section className="features">
          <div className="feature">
            <span className="featureIcon">
              <IconLock />
            </span>
            <h3>私有频道也能取回</h3>
            <p>
              使用你自己的 Telegram 会话解析 <code>t.me/c/…</code> 链接。前提是该账号已加入频道，
              不会绕过任何访问权限。
            </p>
          </div>
          <div className="feature">
            <span className="featureIcon">
              <IconDownload />
            </span>
            <h3>原文件直出，无人工限速</h3>
            <p>
              服务端按块拉取并流式转发，不做二次压缩。实际速度取决于 Telegram、服务器链路与你的网络。
            </p>
          </div>
          <div className="feature">
            <span className="featureIcon">
              <IconVideo />
            </span>
            <h3>分辨率与大小一目了然</h3>
            <p>
              视频显示真实分辨率、时长与文件体积；整组相册会拆分为独立卡片，照片支持多尺寸选择。
            </p>
          </div>
        </section>
      </main>

      <footer className="siteFooter">
        <p>
          仅用于下载你有权访问的内容。Telegram 端到端加密的「秘密聊天」不经过服务器，
          任何第三方工具都无法下载；私有频道必须由你的账号先加入。
        </p>
        <p>
          Vercel 免费版单次请求最长 60 秒，超大文件可能中途结束；大文件建议使用 Vercel Pro
          或自托管部署。
        </p>
        <div className="footerRow">
          <span>TG GRAB · MTProto</span>
          <span>VERCEL READY</span>
        </div>
      </footer>
    </div>
  );
}
