import type { MailModel } from "./mailModel"
import { Theme } from "../theme"

export namespace EmailHtml {
  export interface Preview {
    readonly html: string
    readonly blockedRemoteUrls: number
    readonly blockedInlineImages: number
  }

  export function plainBodyTextForMessage(message: MailModel.MailMessage): string {
    if (message.bodyHtml !== undefined && !htmlHasTags(message.bodyHtml)) return stripHtml(message.bodyHtml)
    return message.bodyText ?? ""
  }

  export function previewForMessage(message: MailModel.MailMessage, remoteContentMode: MailModel.RemoteContentMode, remoteImageProxyBase: string | undefined): Preview | undefined {
    if (message.bodyHtml === undefined || message.bodyHtml.trim().length === 0) return undefined
    if (!htmlHasTags(message.bodyHtml)) return undefined
    const sanitized = sanitizeEmailHtml(message.bodyHtml, remoteContentMode, remoteImageProxyBase, message.inlineImageDataByCid ?? {})
    return {
      html: htmlPreviewDocument(sanitized.html, remoteContentMode, remoteImageProxyBase),
      blockedRemoteUrls: sanitized.blockedRemoteUrls,
      blockedInlineImages: sanitized.blockedInlineImages,
    }
  }

  export function inlineImageCidsInHtml(html: string): Set<string> {
    const cids = new Set<string>()
    if (typeof DOMParser !== "undefined") {
      const document = new DOMParser().parseFromString(html, "text/html")
      for (const element of [...document.body.querySelectorAll("[src]")]) {
        const cid = cidUrl(element.getAttribute("src") ?? "")
        if (cid !== undefined) cids.add(cid)
      }
    }
    for (const match of html.matchAll(/\bcid:([^"'\s<>]+)/gi)) cids.add(normalizeCid(match[1] ?? ""))
    return cids
  }

  export function normalizeCid(value: string): string {
    const trimmed = safeDecodeURIComponent(value.trim()).replace(/^<|>$/g, "")
    return trimmed.toLowerCase()
  }

  export function stripHtml(value: string): string {
    return value
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      .trim()
  }

  function htmlHasTags(value: string): boolean {
    return /<\s*\/?\s*[a-z][^>]*>/i.test(value)
  }

  // Sanitizes mail HTML before iframe render. Scripts/forms are removed; remote images are policy-gated.
  function sanitizeEmailHtml(html: string, remoteContentMode: MailModel.RemoteContentMode, proxyBase: string | undefined, inlineImageDataByCid: Record<string, string>): Preview {
    if (typeof DOMParser === "undefined") return { html: `<pre>${escapeHtml(stripHtml(html))}</pre>`, blockedRemoteUrls: 0, blockedInlineImages: 0 }
    const document = new DOMParser().parseFromString(html, "text/html")
    const blockedRemoteUrls = new Set<string>()
    const blockedInlineImageCids = new Set<string>()
    const loadRemoteImagesDirectly = remoteContentMode === "direct"
    const loadRemoteImagesViaProxy = remoteContentMode === "proxy" && proxyBase !== undefined

    for (const element of [...document.querySelectorAll("script, style, link, iframe, object, embed, form, input, button, video, audio, source, track, svg")]) {
      element.remove()
    }

    for (const element of [...document.body.querySelectorAll("*")]) {
      for (const attribute of [...element.attributes]) {
        const name = attribute.name.toLowerCase()
        const value = attribute.value.trim()

        if (name.startsWith("on") || name === "style" || name === "srcset" || name === "ping" || name === "action" || name === "formaction" || name === "poster" || name === "background") {
          for (const url of remoteUrlsInValue(value)) blockedRemoteUrls.add(url)
          element.removeAttribute(attribute.name)
          continue
        }

        if (name === "href" || name === "xlink:href") {
          element.removeAttribute(attribute.name)
          continue
        }

        if (name === "src") {
          const remoteUrl = remoteHttpUrl(value)
          const cid = cidUrl(value)
          if (cid !== undefined) {
            const inlineImageData = inlineImageDataByCid[cid]
            if (element.tagName.toLowerCase() === "img" && inlineImageData !== undefined) {
              element.setAttribute(attribute.name, inlineImageData)
              element.setAttribute("referrerpolicy", "no-referrer")
            } else {
              blockedInlineImageCids.add(cid)
              element.removeAttribute(attribute.name)
              if (element.tagName.toLowerCase() === "img" && !element.hasAttribute("alt")) element.setAttribute("alt", "[inline image blocked]")
            }
            continue
          }

          if (remoteUrl === undefined) {
            if (!isSafeInlineUrl(value)) element.removeAttribute(attribute.name)
            continue
          }

          blockedRemoteUrls.add(remoteUrl)
          if (element.tagName.toLowerCase() === "img" && loadRemoteImagesDirectly) {
            element.setAttribute(attribute.name, remoteUrl)
            element.setAttribute("referrerpolicy", "no-referrer")
          } else if (element.tagName.toLowerCase() === "img" && loadRemoteImagesViaProxy) {
            element.setAttribute(attribute.name, proxiedRemoteUrl(remoteUrl, proxyBase))
            element.setAttribute("referrerpolicy", "no-referrer")
          } else {
            element.removeAttribute(attribute.name)
            if (element.tagName.toLowerCase() === "img" && !element.hasAttribute("alt")) element.setAttribute("alt", "[remote image blocked]")
          }
        }
      }
    }

    return { html: document.body.innerHTML, blockedRemoteUrls: blockedRemoteUrls.size, blockedInlineImages: blockedInlineImageCids.size }
  }

  function htmlPreviewDocument(bodyHtml: string, remoteContentMode: MailModel.RemoteContentMode, proxyBase: string | undefined): string {
    const proxyOrigin = remoteContentMode === "proxy" && proxyBase !== undefined ? safeOrigin(proxyBase) : undefined
    const imageSrc = remoteContentMode === "direct" ? "data: blob: https: http:" : proxyOrigin === undefined ? "data: blob:" : `data: blob: ${proxyOrigin}`
    const csp = `default-src 'none'; img-src ${imageSrc}; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-src 'none'; connect-src 'none'; media-src 'none'; object-src 'none'`
    return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${escapeHtmlAttribute(csp)}"><style>${Theme.emailPreviewCss()}html,body{max-height:none;overflow-y:visible}body{background:var(--jf-reader-bg);box-sizing:border-box;color:var(--jf-text-strong);font:14px/1.5 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:0;max-width:100%;overflow-x:auto;padding:0}img{height:auto;max-width:100%}table{max-width:100%;border-collapse:collapse}a{color:var(--jf-accent-active);text-decoration:none}</style></head><body>${bodyHtml}</body></html>`
  }

  function proxiedRemoteUrl(remoteUrl: string, proxyBase: string): string {
    if (proxyBase.includes("{url}")) return proxyBase.replaceAll("{url}", encodeURIComponent(remoteUrl))
    const url = new URL(proxyBase)
    url.searchParams.set("url", remoteUrl)
    return url.toString()
  }

  function remoteHttpUrl(value: string): string | undefined {
    const trimmed = value.trim()
    if (/^https?:\/\//i.test(trimmed)) return trimmed
    if (trimmed.startsWith("//")) return `https:${trimmed}`
    return undefined
  }

  function remoteUrlsInValue(value: string): string[] {
    return [...value.matchAll(/(?:https?:)?\/\/[^\s"'<>),]+/gi)].map((match) => match[0].startsWith("//") ? `https:${match[0]}` : match[0])
  }

  function cidUrl(value: string): string | undefined {
    const trimmed = value.trim()
    if (!trimmed.toLowerCase().startsWith("cid:")) return undefined
    return normalizeCid(trimmed.slice(4))
  }

  function safeDecodeURIComponent(value: string): string {
    try {
      return decodeURIComponent(value)
    } catch {
      return value
    }
  }

  function isSafeInlineUrl(value: string): boolean {
    const trimmed = value.trim().toLowerCase()
    return trimmed.length === 0 || trimmed.startsWith("#") || trimmed.startsWith("data:image/") || trimmed.startsWith("blob:")
  }

  function safeOrigin(value: string): string | undefined {
    try {
      return new URL(value).origin
    } catch {
      return undefined
    }
  }

  function escapeHtml(value: string): string {
    return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  }

  function escapeHtmlAttribute(value: string): string {
    return escapeHtml(value).replace(/"/g, "&quot;")
  }
}
