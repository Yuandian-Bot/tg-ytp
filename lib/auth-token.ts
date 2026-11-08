export const AUTH_COOKIE = "tgg_auth";

/**
 * 用访问密码派生一个不可逆的 cookie 值。
 * Web Crypto 同时适用于 Node 与 Edge Runtime。
 */
export async function authToken(password: string): Promise<string> {
  const data = new TextEncoder().encode(`tg-grab:v1:${password}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
