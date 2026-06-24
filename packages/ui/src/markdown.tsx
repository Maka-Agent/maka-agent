/**
 * Markdown rendering layer: the `<Markdown>` body, the `<MarkdownLink>`
 * router (internal `maka://` vs external `<a target=_blank>` vs broken-
 * link inline error), the `<CodeBlock>` framed fenced-code surface with
 * its copy affordance, and the `MakaUriContext` provider that wires
 * the renderer's dispatcher in.
 *
 * PR-UI-LIB-EXTRACT-6 (WAWQAQ msg `510fef52`, round 7/10): pulled out
 * of `components.tsx`. `MakaUriContext` was already a public export
 * (the renderer's main.tsx provides the dispatcher), so `index.ts`
 * re-exports the new module to keep the `@maka/ui` surface identical.
 * `Markdown` / `MarkdownLink` / `CodeBlock` and the helper functions
 * remain package-private — only consumed within `@maka/ui`.
 *
 * byte-for-byte equivalent; behavior unchanged.
 *
 * Why this seam: the Markdown layer is the trust boundary between
 * assistant-emitted text and our renderer. It's where the URI
 * allowlist lives (no `javascript:` / `data:` / `file:` /
 * case-variant `MAKA:` ever reaches the browser), where rehype-highlight
 * tag-detection runs, and where the in-app navigation dispatcher binds.
 * It deserves its own module for the same reason a router does — too
 * many security-sensitive seams to leave buried in a kitchen-sink.
 *
 * PR-UI-LIB-EXTRACT-7 (round 8/10) broke the round-7 ESM cycle:
 * `useClipboardCopyFeedback` has moved out of `components.tsx`
 * into a `clipboard-feedback.ts` leaf module, so this file no
 * longer depends back on `components.tsx` in either direction.
 * Both files now sit downstream of the same shared leaf — the
 * same cycle-breaking pattern PR-UI-LIB-EXTRACT-5 (round 6) used
 * for the round-5 `detectUiLocale` cycle.
 */

import { createContext, useContext, type ReactNode } from 'react';
import * as React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import rehypeHighlight from 'rehype-highlight';
import { Check, Copy } from './icons.js';

import { Button as UiButton } from './ui.js';
import {
  isMakaUriCandidate,
  isSafeExternalScheme,
  parseMakaUri,
  type MakaUriDest,
} from './maka-uri.js';
import { useClipboardCopyFeedback } from './clipboard-feedback.js';

const MARKDOWN_REMARK_PLUGINS = [remarkGfm, remarkBreaks];
const MARKDOWN_REHYPE_PLUGINS = [
  // `detect: true` lets hljs guess the language when the fence didn't tag one;
  // `ignoreMissing: true` keeps bogus tags like ```mermaid from throwing.
  [rehypeHighlight, { detect: true, ignoreMissing: true }],
] as const;

export function Markdown(props: { text: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={MARKDOWN_REMARK_PLUGINS}
      rehypePlugins={MARKDOWN_REHYPE_PLUGINS as never}
      components={{
        // PR-UI-RENDER-2: route `maka://` links through the internal
        // URI parser so the assistant can drop in-app navigation
        // affordances ("用账号登录 Settings → Account"). The parser
        // is a strict allowlist; anything outside (`maka://tool/`,
        // `maka://auth/`, malformed sections) renders as a
        // non-clickable broken-link inline error. NEVER falls back
        // to `openExternal` — internal-link routing must not become
        // a hidden external-URL escape.
        a: ({ children, href, ...rest }) => (
          <MarkdownLink href={href} {...rest}>
            {children}
          </MarkdownLink>
        ),
        // Inline `code` keeps the bubble's foreground color; only block code
        // gets the framed treatment via `pre > code` in CSS.
        code: ({ children, className, ...rest }) => (
          <code {...rest} className={className}>
            {children}
          </code>
        ),
        // Wrap block code with a language pill header + copy affordance.
        // The pill is from an external design reference (40-markdown-deep §7a) — surfaces the
        // detected language so users can verify hljs got it right.
        pre: ({ children, ...rest }) => <CodeBlock {...rest}>{children}</CodeBlock>,
      }}
    >
      {props.text}
    </ReactMarkdown>
  );
}

/**
 * PR-UI-RENDER-2 — Markdown link router.
 *
 * Routes by parser result, NOT by string inspection in JSX:
 *
 *   parseMakaUri(href)
 *     ├─ MakaUriDest      → <button onClick={dispatch(dest)}>
 *     ├─ null AND isMakaUri  → broken-link inline error <span>
 *     │                        (NOT a clickable element; NOT openExternal)
 *     └─ null AND !isMakaUri → ordinary external link (Electron OS browser)
 *
 * The `MakaUriContext` provider in `main.tsx` injects the dispatcher
 * once at the App root; consumers read it via `useContext`. If a
 * Markdown island renders without a provider, valid `maka://` links
 * still get the broken-link treatment (we don't trigger uninstalled
 * navigation).
 */
function MarkdownLink(props: {
  href?: string;
  children?: ReactNode;
  [key: string]: unknown;
}) {
  const { href, children, ...rest } = props;
  const dispatch = useContext(MakaUriContext);

  // PR-UI-C2 review fixup (@kenji msg 7fb8d15c): case-insensitive
  // candidate probe so `Maka://` / `MAKA://` / `MaKa://` route to
  // the broken-link inline error rather than falling through to
  // the external `<a target=_blank>` path. `parseMakaUri` still
  // strictly accepts only lowercase `maka:`, so case-variants
  // hit the `internal-link-broken` rendering with the "内部链接
  // 无效" copy.
  if (typeof href === 'string' && isMakaUriCandidate(href)) {
    const dest = parseMakaUri(href);
    if (dest && dispatch) {
      // Valid internal link with an installed dispatcher.
      // Render as a button (not <a>) so screen readers announce
      // "button" rather than "link" — this is in-app navigation,
      // not a hyperlink to a URL.
      return (
        <button
          type="button"
          className="maka-markdown-link maka-markdown-link-internal"
          data-maka-uri-kind={dest.kind}
          onClick={() => dispatch(dest)}
        >
          {children}
        </button>
      );
    }
    // Either parseMakaUri returned null (unsupported namespace /
    // malformed section / case-variant scheme) OR no dispatcher
    // is installed. Render as a non-clickable broken-link inline
    // error. Plain `<span>` (no role) so screen readers do not
    // announce it as a link or button.
    return (
      <span
        className="maka-markdown-link maka-markdown-link-broken"
        data-reason="internal-invalid"
        title="内部链接无效"
        aria-label="内部链接无效"
      >
        {children}
      </span>
    );
  }

  // PR-UI-C2 review fixup (@kenji msg 7fb8d15c): explicit safe-
  // scheme gate on the external path. Only `http:` / `https:` /
  // `mailto:` are rendered as `<a target=_blank>`. Anything else
  // (`javascript:`, `data:`, `file:`, `vbscript:`, custom schemes,
  // garbage / unparseable hrefs) renders as a non-clickable
  // "link unsafe" inline error. Distinct copy + data-reason from
  // the internal-invalid case so visual-smoke baselines can
  // distinguish which gate fired.
  if (typeof href === 'string' && isSafeExternalScheme(href)) {
    return (
      <a {...rest} href={href} className="maka-markdown-link maka-markdown-link-external" target="_blank" rel="noreferrer noopener">
        {children}
      </a>
    );
  }
  return (
    <span
      className="maka-markdown-link maka-markdown-link-broken"
      data-reason="unsafe-scheme"
      title="链接不安全"
      aria-label="链接不安全"
    >
      {children}
    </span>
  );
}

/**
 * PR-UI-RENDER-2 — context for the internal-link dispatcher.
 *
 * The desktop renderer installs the dispatcher once at the App root
 * (see `apps/desktop/src/renderer/main.tsx`). The dispatcher takes a
 * typed `MakaUriDest` and routes to whatever real navigation surface
 * the app uses (e.g. `setNavSelection({section: 'settings', tab: ...})`
 * for `kind: 'settings'`, or `composer.prefill(text)` for `kind:
 * 'compose'`). The Markdown link renderer never invokes navigation
 * directly — that's the dispatcher's job, and the dispatcher is the
 * single chokepoint to add observability / consent prompts later.
 */
export const MakaUriContext = createContext<((dest: MakaUriDest) => void) | undefined>(undefined);

function CodeBlock({ children, ...rest }: { children?: ReactNode }) {
  // Extract the language from the inner <code class="language-xxx hljs"> if
  // there is one. react-markdown's `pre` always receives a single `code`
  // child, but downstream rehype plugins may have layered classes on it.
  const code = isElementWithClassName(children) ? children : null;
  const lang = code?.props.className?.match(/language-([A-Za-z0-9_+-]+)/)?.[1]?.toLowerCase();
  const copyFeedback = useClipboardCopyFeedback(1400, { redact: false });
  const copyPhase = copyFeedback.phaseFor('code');
  const copyPending = copyPhase === 'pending';
  const copied = copyPhase === 'copied';

  async function copy() {
    const text = collectCodeText(code?.props.children);
    await copyFeedback.copy('code', text);
  }

  return (
    <div className="maka-code-block">
      <div className="maka-code-block-header">
        <span className="maka-code-block-lang">{lang ?? 'code'}</span>
        <UiButton
          type="button"
          className="maka-code-block-copy"
          variant="quiet"
          size="icon-sm"
          onClick={() => void copy()}
          aria-label={copyPhase === 'pending' ? '复制代码中' : copyPhase === 'copied' ? '已复制代码' : copyPhase === 'failed' ? '复制代码失败' : '复制代码'}
          aria-busy={copyPending ? 'true' : undefined}
          disabled={copyPending}
          data-copied={copied}
          data-copy-feedback={copyPhase ?? undefined}
          data-pending={copyPending ? 'true' : undefined}
        >
          {copied
            ? <Check size={12} strokeWidth={2} aria-hidden="true" />
            : <Copy size={12} strokeWidth={1.75} aria-hidden="true" />}
        </UiButton>
      </div>
      <pre {...rest}>{children}</pre>
    </div>
  );
}

function isElementWithClassName(node: ReactNode): node is React.ReactElement<{ className?: string; children?: ReactNode }> {
  return typeof node === 'object' && node !== null && 'props' in node;
}

function collectCodeText(children: ReactNode): string {
  if (typeof children === 'string') return children;
  if (Array.isArray(children)) return children.map(collectCodeText).join('');
  if (isElementWithClassName(children)) return collectCodeText(children.props.children);
  return '';
}
