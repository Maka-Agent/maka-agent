/**
 * Pre-bundled brand SVG bodies for the IM channels Maka uses for bot
 * delivery (Telegram / WeChat / WeCom / Discord / DingTalk / Feishu /
 * QQ).
 *
 * Why local instead of `simple-icons:*` runtime CDN fetch:
 *   The bot logos used to render through `<IconifyIcon
 *   icon="simple-icons:telegram">`, which Iconify lazy-fetches from
 *   `https://api.iconify.design/...` on first render. On cold-offline
 *   Electron launches (or when network is firewalled) the bot picker
 *   would degrade to the `glyph` monogram fallback for the entire
 *   session. That is wrong end-result: a desktop app's brand logos
 *   should not depend on a third-party CDN at runtime
 *   (@kenji audit msg `e4cfbfb0` finding round-2 #2).
 *
 * Visual treatment: every brand renders as a real iOS-app-icon-style
 * tile — brand-color disc with the white official mark on top —
 * matching the realism of `provider-brand-marks.tsx` for model
 * providers (Claude orange nautilus, Gemini 4-color gradient,
 * DeepSeek blue wave, etc.) WAWQAQ msg `f3d263b4` 2026-06-26:
 * "现在怎么还是这种 svg 抽象风格的啊，我希望的是模型图标的那种的真的写实风格的，
 * 用他们真实的logo".
 *
 * Sources by brand:
 *   - telegram        : Logos collection (CC-BY 4.0), `@iconify-json/
 *                       logos`. Multi-color: linear gradient blue
 *                       disc (#2AABEE → #229ED9) + white paper plane.
 *   - discord         : Logos collection (CC-BY 4.0), `discord-icon`.
 *                       Filled brand #5865F2 (blurple) Clyde silhouette.
 *   - feishu          : Lark / Feishu official brand mark — 3-tier
 *                       staircase shape in #3370FF / #14C0FF / #93E55E,
 *                       extracted from www.feishu.cn product page
 *                       inline SVG. Trademark of Beijing Douyin Vision
 *                       Co., used for product identification.
 *   - wechat, wecom,
 *     dingtalk, qq    : Real Ant Design Icons (MIT) brand-mark paths
 *                       (`wechat` / `wechat-work` / `dingtalk` / `qq`)
 *                       rendered in white on a brand-color disc, 1024
 *                       grid each. Brand colors: WeChat #07C160 green,
 *                       WeCom #0089FF blue, DingTalk #1372FB blue, QQ
 *                       #12B7F5 light blue (the canonical QQ-penguin
 *                       blue, NOT the older red palette some legacy
 *                       app icons used — replacing my hand-drawn
 *                       attempt from PR-BOT-LOGO-NEUTRAL-PLATE-0 that
 *                       had path-distortion + brand-color drift).
 *
 * Trademark notice: all brand marks remain the property of their
 * respective owners and are rendered here only to identify the
 * corresponding channel inside the Settings UI, not as endorsement.
 */

export interface MakaBotIconBody {
  body: string;
  /**
   * Per-icon viewBox. Defaults to 0 / 0 / 24 / 24 when omitted (the
   * collection-level dimensions registered in `icons.tsx`). Specify
   * for paths sourced from larger canvases — e.g. Telegram's 256
   * grid, the Feishu 40 grid, or QQ's 24 grid with different padding.
   */
  left?: number;
  top?: number;
  width?: number;
  height?: number;
}

export const MAKA_BOT_ICON_BODIES: Record<string, MakaBotIconBody> = {
  // Telegram — Logos collection (CC-BY 4.0). Multi-color: gradient
  // blue disc + white paper plane silhouette.
  telegram: {
    body: '<defs><linearGradient id="maka-bot-telegram-grad" x1="50%" x2="50%" y1="0%" y2="100%"><stop offset="0%" stop-color="#2aabee"/><stop offset="100%" stop-color="#229ed9"/></linearGradient></defs><path fill="url(#maka-bot-telegram-grad)" d="M128 0C94.06 0 61.48 13.494 37.5 37.49A128.04 128.04 0 0 0 0 128c0 33.934 13.5 66.514 37.5 90.51C61.48 242.506 94.06 256 128 256s66.52-13.494 90.5-37.49c24-23.996 37.5-56.576 37.5-90.51s-13.5-66.514-37.5-90.51C194.52 13.494 161.94 0 128 0"/><path fill="#fff" d="M57.94 126.648q55.98-24.384 74.64-32.152c35.56-14.786 42.94-17.354 47.76-17.441c1.06-.017 3.42.245 4.96 1.49c1.28 1.05 1.64 2.47 1.82 3.467c.16.996.38 3.266.2 5.038c-1.92 20.24-10.26 69.356-14.5 92.026c-1.78 9.592-5.32 12.808-8.74 13.122c-7.44.684-13.08-4.912-20.28-9.63c-11.26-7.386-17.62-11.982-28.56-19.188c-12.64-8.328-4.44-12.906 2.76-20.386c1.88-1.958 34.64-31.748 35.26-34.45c.08-.338.16-1.598-.6-2.262c-.74-.666-1.84-.438-2.64-.258c-1.14.256-19.12 12.152-54 35.686c-5.1 3.508-9.72 5.218-13.88 5.128c-4.56-.098-13.36-2.584-19.9-4.708c-8-2.606-14.38-3.984-13.82-8.41c.28-2.304 3.46-4.662 9.52-7.072"/>',
    width: 256,
    height: 256,
  },

  // Feishu / Lark — official 3-tier staircase mark, multi-color blue
  // → cyan → green. Extracted from www.feishu.cn product page on
  // 2026-06-26 (the inline SVG used for Lark suite branding). Sized
  // on a 40-unit canvas matching the upstream artwork.
  feishu: {
    body: '<path fill="#3370FF" d="M5.74994 5.75C5.74994 4.92157 6.4215 4.25 7.24994 4.25C13.7499 4.25 20.2499 4.25 26.7499 4.25C30.8921 4.25 34.2499 7.60785 34.2499 11.75C34.2499 19.25 34.2499 26.75 34.2499 34.25C34.2499 35.0785 33.5783 35.75 32.7499 35.75H13.4526C11.4098 35.75 9.45054 34.9691 8.006 33.5791C6.56147 32.1892 5.74988 29.9849 5.74988 28.0192L5.74994 5.75Z"/><path fill="#14C0FF" d="M5.74988 12.4978H21.4999C24.3994 12.4978 26.7499 14.8483 26.7499 17.7478V35.7478H13.2499C9.10775 35.7478 5.74988 32.2896 5.74988 28.1475V12.4978Z"/><path fill="#93E55E" d="M5.74988 20.7566H16.2499C17.9068 20.7566 19.2499 22.0997 19.2499 23.7566V35.7566H13.2499C9.10775 35.7566 5.74988 32.3988 5.74988 28.2567V20.7566Z"/>',
    width: 40,
    height: 40,
  },

  // WeChat — Ant Design Icons (MIT), `wechat` filled. Real WeChat
  // brand mark (two overlapping chat bubbles + 4 eye dots) on the
  // canonical Tencent WeChat green #07C160 disc. 1024 grid.
  wechat: {
    body: '<circle cx="512" cy="512" r="512" fill="#07C160"/><path fill="#fff" d="M690.1 377.4c5.9 0 11.8.2 17.6.5-24.4-128.7-158.3-227.1-319.9-227.1C209 150.8 64 271.4 64 420.2c0 81.1 43.6 154.2 111.9 203.6a21.5 21.5 0 0 1 9.1 17.6c0 2.4-.5 4.6-1.1 6.9-5.5 20.3-14.2 52.8-14.6 54.3-.7 2.6-1.7 5.2-1.7 7.9 0 5.9 4.8 10.8 10.8 10.8 2.3 0 4.2-.9 6.2-2l70.9-40.9c5.3-3.1 11-5 17.2-5 3.2 0 6.4.5 9.5 1.4 33.1 9.5 68.8 14.8 105.7 14.8 6 0 11.9-.1 17.8-.4-7.1-21-10.9-43.1-10.9-66 0-135.8 132.2-245.8 295.3-245.8zm-194.3-86.5c23.8 0 43.2 19.3 43.2 43.1s-19.3 43.1-43.2 43.1c-23.8 0-43.2-19.3-43.2-43.1s19.4-43.1 43.2-43.1zm-215.9 86.2c-23.8 0-43.2-19.3-43.2-43.1s19.3-43.1 43.2-43.1 43.2 19.3 43.2 43.1-19.4 43.1-43.2 43.1zm586.8 415.6c56.9-41.2 93.2-102 93.2-169.7 0-124-120.8-224.5-269.9-224.5-149 0-269.9 100.5-269.9 224.5S540.9 847.5 690 847.5c30.8 0 60.6-4.4 88.1-12.3 2.6-.8 5.2-1.2 7.9-1.2 5.2 0 9.9 1.6 14.3 4.1l59.1 34c1.7 1 3.3 1.7 5.2 1.7a9 9 0 0 0 6.4-2.6 9 9 0 0 0 2.6-6.4c0-2.2-.9-4.4-1.4-6.6-.3-1.2-7.6-28.3-12.2-45.3-.5-1.9-.9-3.8-.9-5.7.1-5.9 3.1-11.2 7.6-14.5zM600.2 587.2c-19.9 0-36-16.1-36-35.9 0-19.8 16.1-35.9 36-35.9s36 16.1 36 35.9c0 19.8-16.2 35.9-36 35.9zm179.9 0c-19.9 0-36-16.1-36-35.9 0-19.8 16.1-35.9 36-35.9s36 16.1 36 35.9a36.08 36.08 0 0 1-36 35.9z"/>',
    width: 1024,
    height: 1024,
  },

  // WeCom 企业微信 — Ant Design Icons (MIT), `wechat-work` filled.
  // Real Tencent Enterprise WeChat brand mark on the official blue
  // disc #0089FF. The Ant Design path uses an inner translate(112 112)
  // to center an 800x800 mark inside the 1024 canvas, preserved here.
  wecom: {
    body: '<circle cx="512" cy="512" r="512" fill="#0089FF"/><g transform="translate(112 112)"><path fill="#fff" fill-rule="evenodd" d="M693.333 0H106.667C47.756 0 0 47.756 0 106.667v586.666C0 752.244 47.756 800 106.667 800h586.666C752.244 800 800 752.244 800 693.333V106.667C800 47.756 752.244 0 693.333 0m-98.169 417.862a102.129 102.129 0 0 0 28.09 52.454l2.137 2.062c.409.275.796.573 1.156.902l.555.636.191.022a7.964 7.964 0 0 1-.969 10.818 7.964 7.964 0 0 1-10.853-.178c-1.102-1.05-2.142-2.142-3.24-3.24a102.489 102.489 0 0 0-53.818-28.356l-2.004-.275c-.658-.116-1.342-.387-1.978-.387-16.28-3.785-27.224-19.06-25.574-35.692 1.65-16.632 15.384-29.458 32.09-29.97 16.72-.5 31.213 11.487 33.857 28.004.165 1.085.36 2.156.36 3.2M382.062 571.684a276.782 276.782 0 0 1-61.706.165 267.307 267.307 0 0 1-44.663-8.605l-68.44 34.405c-.329.244-.769.431-1.15.711h-.276a18.289 18.289 0 0 1-27.516-15.902c.027-.587.093-1.17.191-1.742.134-1.97.6-3.898 1.378-5.712l2.747-11.155 9.564-39.56a277.573 277.573 0 0 1-49.253-54.671 185.987 185.987 0 0 1-31.827-103.516 182.422 182.422 0 0 1 19.076-81.044 203.982 203.982 0 0 1 37.19-52.316c38.916-39.938 93.259-65.52 153.094-72.035a278.247 278.247 0 0 1 30.182-1.64c10.498.03 20.987.649 31.414 1.866 59.586 6.783 113.653 32.476 152.266 72.36a202.96 202.96 0 0 1 37 52.476 182.298 182.298 0 0 1 18.17 94.675c-.52-.577-1.019-1.208-1.57-1.76-10.873-10.836-27.75-12.823-40.844-4.808.222-2.254.222-4.538.222-6.783a143.644 143.644 0 0 0-14.76-63.382 164.071 164.071 0 0 0-29.684-42.147c-31.774-32.768-76.467-53.955-125.885-59.55a234.369 234.369 0 0 0-51.67-.143c-49.614 5.413-94.605 26.453-126.574 59.262a163.631 163.631 0 0 0-29.818 41.951 143.436 143.436 0 0 0-15.12 63.925 147.156 147.156 0 0 0 25.289 81.515 170.498 170.498 0 0 0 24.929 29.396 172.311 172.311 0 0 0 17.564 14.747 17.6 17.6 0 0 1 6.351 19.622l-6.489 24.667-1.866 7.146-1.622 6.45a2.849 2.849 0 0 0 2.777 2.88 3.987 3.987 0 0 0 1.925-.68l43.866-25.934 1.432-.774a23.2 23.2 0 0 1 18.248-1.84c11.09 3.23 22.41 5.61 33.863 7.12l5.222.685a227.257 227.257 0 0 0 51.671-.138 226.578 226.578 0 0 0 42.747-9.067c-1.498 15.476 7.943 29.919 22.72 34.756a269.267 269.267 0 0 1-60.365 14.124m89.071-24.875a33.333 33.333 0 0 1-33.764-18.747 33.316 33.316 0 0 1 6.644-38.03 33.156 33.156 0 0 1 18.254-9.312c1.07-.142 2.19-.36 3.24-.36a102.373 102.373 0 0 0 52.475-28.053l2.2-2.33a10.21 10.21 0 0 1 1.57-1.68v-.026a7.969 7.969 0 1 1 10.64 11.809l-3.245 3.24a102.44 102.44 0 0 0-28.56 53.738c-.085.635-.276 1.35-.276 2.009l-.387 2.004a33.293 33.293 0 0 1-28.79 25.738m94.431 93.867c-16.405 2.02-31.809-8.303-36.177-24.245a28.009 28.009 0 0 1-1.098-6.729 102.4 102.4 0 0 0-28.147-52.39l-2.31-2.25a7.191 7.191 0 0 1-1.103-.91l-.542-.6h-.031v.057a7.964 7.964 0 0 1 .964-10.818 7.956 7.956 0 0 1 10.849.178l3.222 3.24a102.289 102.289 0 0 0 53.791 28.355l2.005.272a33.271 33.271 0 1 1-1.423 65.84m113.672-103.338a32.836 32.836 0 0 1-18.276 9.315 26.364 26.364 0 0 1-3.24.36 102.32 102.32 0 0 0-52.444 28.103 49.566 49.566 0 0 0-3.138 3.408l-.68.552h.022l.084.053a7.938 7.938 0 1 1-10.604-11.809l3.24-3.24a102.053 102.053 0 0 0 28.364-53.707 33.262 33.262 0 1 1 62.405-12.093 33.213 33.213 0 0 1-5.733 39.058"/></g>',
    width: 1024,
    height: 1024,
  },

  // Discord — Logos collection (CC-BY 4.0), `discord-icon`. Filled
  // Discord blurple (#5865f2) Clyde silhouette. Rendered as
  // iOS-app-icon style by sitting on a same-color disc so the white
  // Clyde reads as the official Discord app icon.
  discord: {
    body: '<circle cx="128" cy="100" r="128" fill="#5865F2"/><path fill="#fff" d="M186.4 49.6a161.4 161.4 0 0 0-40.9-12.7c-1.8 3.2-3.8 7.4-5.2 10.8a149.6 149.6 0 0 0-45.3 0c-1.4-3.4-3.5-7.6-5.3-10.8a160.9 160.9 0 0 0-40.9 12.9C26.4 89 18.4 127 20.4 164.4a163 163 0 0 0 50.2 25.7a126 126 0 0 0 10.8-17.8a105.6 105.6 0 0 1-16.9-8.2a85 85 0 0 0 4.1-3.3c32.6 15.3 68 15.3 100.3 0c1.4.9 2.7 1.8 4.1 3.3a106 106 0 0 1-17 8.2a126 126 0 0 0 10.7 17.8a163.5 163.5 0 0 0 50.2-25.7c4.1-43.5-11-81.4-29.4-114.8M67.9 142.4c-9.8 0-17.8-9.2-17.8-20.3s7.9-20.4 17.8-20.4s17.9 9.2 17.8 20.4c0 11.1-7.9 20.3-17.8 20.3m65.8 0c-9.7 0-17.8-9.2-17.8-20.3s7.9-20.4 17.8-20.4c10 0 18 9.2 17.9 20.4c0 11.1-7.9 20.3-17.9 20.3"/>',
    width: 256,
    height: 256,
  },

  // DingTalk 钉钉 — Ant Design Icons (MIT), `dingtalk` outlined. Real
  // Alibaba DingTalk brand mark (the iconic "D + thumb" silhouette)
  // on the official Dingding system blue #1372FB. 1024 grid.
  dingtalk: {
    body: '<circle cx="512" cy="512" r="512" fill="#1372FB"/><path fill="#fff" d="M573.7 252.5C422.5 197.4 201.3 96.7 201.3 96.7c-15.7-4.1-17.9 11.1-17.9 11.1-5 61.1 33.6 160.5 53.6 182.8 19.9 22.3 319.1 113.7 319.1 113.7S326 357.9 270.5 341.9c-55.6-16-37.9 17.8-37.9 17.8 11.4 61.7 64.9 131.8 107.2 138.4 42.2 6.6 220.1 4 220.1 4s-35.5 4.1-93.2 11.9c-42.7 5.8-97 12.5-111.1 17.8-33.1 12.5 24 62.6 24 62.6 84.7 76.8 129.7 50.5 129.7 50.5 33.3-10.7 61.4-18.5 85.2-24.2L565 743.1h84.6L603 928l205.3-271.9H700.8l22.3-38.7c.3.5.4.8.4.8S799.8 496.1 829 433.8l.6-1h-.1c5-10.8 8.6-19.7 10-25.8 17-71.3-114.5-99.4-265.8-154.5z"/>',
    width: 1024,
    height: 1024,
  },

  // QQ — Ant Design Icons (MIT), `qq` outlined. Real Tencent QQ
  // penguin silhouette on the canonical QQ light blue #12B7F5 (NOT
  // the older red palette — QQ's brand identity is the blue penguin).
  // 1024 grid.
  qq: {
    body: '<circle cx="512" cy="512" r="512" fill="#12B7F5"/><path fill="#fff" d="M824.8 613.2c-16-51.4-34.4-94.6-62.7-165.3C766.5 262.2 689.3 112 511.5 112 331.7 112 256.2 265.2 261 447.9c-28.4 70.8-46.7 113.7-62.7 165.3-34 109.5-23 154.8-14.6 155.8 18 2.2 70.1-82.4 70.1-82.4 0 49 25.2 112.9 79.8 159-26.4 8.1-85.7 29.9-71.6 53.8 11.4 19.3 196.2 12.3 249.5 6.3 53.3 6 238.1 13 249.5-6.3 14.1-23.8-45.3-45.7-71.6-53.8 54.6-46.2 79.8-110.1 79.8-159 0 0 52.1 84.6 70.1 82.4 8.5-1.1 19.5-46.4-14.5-155.8z"/>',
    width: 1024,
    height: 1024,
  },
};

export const MAKA_BOT_ICON_PREFIX = 'maka-bot';
