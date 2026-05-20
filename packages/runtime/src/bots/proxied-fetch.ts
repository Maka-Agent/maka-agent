import { fetch, type Dispatcher, type RequestInit as UndiciRequestInit } from 'undici';
import { matchesBypassList } from '../network/bypass-matcher.js';
import { buildProxyDispatcher } from '../network/proxy-dispatcher.js';
import { resolveActiveProxy } from '../network/active-proxy-state.js';

export async function proxiedFetch(
  url: string,
  init?: UndiciRequestInit & { signal?: AbortSignal },
): Promise<Response> {
  const proxy = resolveActiveProxy();
  let dispatcher: Dispatcher | undefined;
  if (proxy && !matchesBypassList(new URL(url).hostname, proxy.bypassList)) {
    dispatcher = buildProxyDispatcher(proxy) as Dispatcher;
  }
  try {
    return await fetch(url, { ...init, dispatcher }) as unknown as Response;
  } finally {
    const close = (dispatcher as { close?: () => Promise<void> } | undefined)?.close;
    if (typeof close === 'function') void close.call(dispatcher).catch(() => {});
  }
}
