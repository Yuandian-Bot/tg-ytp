#!/usr/bin/env node
/**
 * 在本地生成 Telegram StringSession。
 * 用法：npm run login
 *
 * 如果网络无法直连 Telegram（例如在国内），可设置环境变量 TG_PROXY 走 SOCKS5 代理：
 *   CMD:    set TG_PROXY=socks5://127.0.0.1:7890
 *   PowerShell: $env:TG_PROXY="socks5://127.0.0.1:7890"
 *   macOS/Linux: export TG_PROXY=socks5://127.0.0.1:7890
 *
 * 也支持带账号密码的代理：socks5://user:pass@127.0.0.1:7890
 * 生成的 TG_SESSION 只应保存在你的环境变量中，不要提交到 Git。
 */
const readline = require("node:readline/promises");
const { stdin, stdout } = require("node:process");
const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");

/**
 * 解析 socks5://[user:pass@]host:port 格式的代理字符串。
 */
function parseProxy(raw) {
  if (!raw) return undefined;
  const str = raw.trim();
  const match = /^(?:socks5?:\/\/)?(?:([^:@]+)(?::([^@]*))?@)?([^:]+):(\d+)$/.exec(str);
  if (!match) {
    throw new Error("代理格式错误，应为 socks5://127.0.0.1:7890");
  }
  const [, username, password, ip, port] = match;
  return { ip, port: Number(port), socksType: 5, username, password };
}

async function main() {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  const ask = async (question) => (await rl.question(question)).trim();

  console.log("\nTG Grab · 本地登录\n");
  console.log("api_id / api_hash 可使用 Telegram 官方客户端的公开凭证：2040 / b18441a1ff607e10a989891a5462e627\n");

  const apiId = Number(await ask("TG_API_ID: "));
  const apiHash = await ask("TG_API_HASH: ");
  const phone = await ask("手机号（含国家码，例如 +8613800000000）: ");

  if (!Number.isFinite(apiId) || !apiHash || !phone) {
    console.error("\n参数不完整，已退出。");
    rl.close();
    process.exit(1);
  }

  let proxy;
  try {
    proxy = parseProxy(process.env.TG_PROXY);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }

  if (proxy) {
    console.log(`\n通过 SOCKS5 代理连接：${proxy.ip}:${proxy.port}`);
  } else {
    console.log("\n未设置 TG_PROXY，将直连 Telegram（国内网络可能连接失败）。");
    console.log("如需代理，先执行：set TG_PROXY=socks5://127.0.0.1:7890\n");
  }

  const client = new TelegramClient(new StringSession(""), apiId, apiHash, {
    connectionRetries: 5,
    proxy,
  });

  await client.start({
    phoneNumber: async () => phone,
    password: async () => ask("两步验证密码（没有则直接回车）: "),
    phoneCode: async () => ask("Telegram 验证码: "),
    onError: (error) => console.error("\n登录出错：", error.message || error),
  });

  console.log("\n登录成功。把下面整段内容保存为 Vercel 环境变量 TG_SESSION：\n");
  console.log(client.session.save());
  console.log("\n注意：这段字符串等同于你的 Telegram 登录凭证，请勿泄露。\n");

  await client.disconnect();
  rl.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
