import process from "node:process";

import { Agent, type Dispatcher, interceptors, ProxyAgent } from "undici";

const AGENT_OPTIONS: Agent.Options = {
  connect: {
    timeout: 30_000,
  },
  headersTimeout: 30_000,
  bodyTimeout: 30_000,
  connections: 16,
};

// undici 默认不读取代理环境变量,这里手动解析。
// 不用 EnvHttpProxyAgent:它是实验特性,加载时向 stderr 输出警告,会污染 CLI 的 JSON 输出
function resolveProxyUrlFromEnv() {
  const { env } = process;
  return env.HTTPS_PROXY ?? env.https_proxy ?? env.HTTP_PROXY ?? env.http_proxy;
}

const proxyUrl = resolveProxyUrlFromEnv();
const PROXY_AWARE_AGENT: Dispatcher = proxyUrl
  ? new ProxyAgent({ uri: proxyUrl, ...AGENT_OPTIONS })
  : new Agent(AGENT_OPTIONS);

// 供 @xmcl/installer 直接 dispatch 使用;fetch 调用方不要用它(fetch 自带重定向处理)
export const DOWNLOAD_DISPATCHER = PROXY_AWARE_AGENT.compose(
  interceptors.retry({
    maxRetries: 4,
    minTimeout: 500,
    maxTimeout: 5_000,
  }),
  interceptors.redirect({
    maxRedirections: 5,
  }),
);

export const proxyAwareFetch: typeof fetch = (input, init) => {
  // DOM 的 RequestInit 类型不含 undici 的 dispatcher 扩展字段
  const initWithDispatcher: RequestInit & { dispatcher: Dispatcher } = {
    dispatcher: PROXY_AWARE_AGENT,
    ...init,
  };
  return fetch(input, initWithDispatcher);
};
