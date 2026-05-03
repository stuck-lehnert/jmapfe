import { FetchJmapTransport, JmapTransportError, type BlobLike } from "@jmapfe/jmap-core"
import { invoke, isTauri as tauriRuntimeAvailable } from "@tauri-apps/api/core"

export namespace AttachmentBackend {
  export interface AttachmentPart {
    readonly name: string
    readonly type: string
    readonly blobId?: string
  }

  export interface ZipEntryData {
    readonly name: string
    readonly bytes: Uint8Array
  }

  export interface SaveFileTarget {
    write(blob: Blob): Promise<void>
  }

  interface BrowserSaveFileHandle {
    createWritable(): Promise<BrowserWritableFileStream>
  }

  interface BrowserWritableFileStream {
    write(data: Blob): Promise<void>
    close(): Promise<void>
  }

  /**
   * Downloads attachment bytes, retrying strict servers with octet-stream.
   * Some JMAP servers reject the advertised MIME type in the download URL.
   */
  export async function downloadBlob(transport: FetchJmapTransport, accountId: string, attachment: AttachmentPart): Promise<BlobLike> {
    if (attachment.blobId === undefined) throw new Error("Attachment has no blob id.")
    try {
      return await transport.download(accountId, attachment.blobId, attachment.name, attachment.type)
    } catch (error) {
      if (!shouldRetryDownloadAsOctetStream(error, attachment.type)) throw error
      return transport.download(accountId, attachment.blobId, attachment.name, "application/octet-stream")
    }
  }

  /** Opens an attachment using OS default app in Tauri, browser tab on web. */
  export async function openBlob(name: string, type: string, blobLike: BlobLike): Promise<void> {
    const safeName = safeAttachmentFileName(name)
    const blob = blobLikeToBlob(blobLike, type)
    if (isTauriRuntime()) {
      await invoke<void>("open_file", {
        req: {
          suggestedName: safeName,
          bytesBase64: base64Bytes(new Uint8Array(await blob.arrayBuffer())),
        },
      })
      return
    }
    openBlobInNewTab(blob)
  }

  /** Returns writable target using native save dialog where available. */
  export async function promptSaveFile(name: string, type: string): Promise<SaveFileTarget> {
    const safeName = safeAttachmentFileName(name)
    if (isTauriRuntime()) {
      return {
        write: async (blob) => {
          const saved = await invoke<boolean>("save_file", {
            req: {
              suggestedName: safeName,
              bytesBase64: base64Bytes(new Uint8Array(await blob.arrayBuffer())),
            },
          })
          if (!saved) throw new SaveFileCancelledError()
        },
      }
    }

    const picker = (globalThis as unknown as { readonly showSaveFilePicker?: (options: { readonly suggestedName: string; readonly types?: readonly { readonly description: string; readonly accept: Record<string, readonly string[]> }[] }) => Promise<BrowserSaveFileHandle> }).showSaveFilePicker
    if (typeof picker === "function") {
      const types = saveFilePickerTypes(safeName, type)
      const handle = await picker({ suggestedName: safeName, ...(types === undefined ? {} : { types }) })
      return {
        write: async (blob) => {
          const writable = await handle.createWritable()
          try {
            await writable.write(blob)
          } finally {
            await writable.close()
          }
        },
      }
    }
    return { write: async (blob) => downloadBytesOrBlob(blob, safeName) }
  }

  export function isSaveFileCancelled(error: unknown): boolean {
    return error instanceof SaveFileCancelledError || (error instanceof DOMException && error.name === "AbortError")
  }

  export async function blobLikeToBytes(blob: BlobLike): Promise<Uint8Array> {
    return blob instanceof Blob
      ? new Uint8Array(await blob.arrayBuffer())
      : blob instanceof ArrayBuffer
        ? new Uint8Array(blob)
        : blob
  }

  export function blobLikeToBlob(blob: BlobLike, type: string): Blob {
    if (blob instanceof Blob) return blob.type === type ? blob : new Blob([blob], { type })
    if (blob instanceof ArrayBuffer) return new Blob([blob], { type })
    return new Blob([bufferSource(blob)], { type })
  }

  export function base64Bytes(bytes: Uint8Array): string {
    let binary = ""
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
    }
    return btoa(binary)
  }

  /**
   * Creates a small, dependency-free ZIP archive for "download all".
   * Files are stored without compression to avoid heavy browser-side CPU cost.
   */
  export function createZip(entries: readonly ZipEntryData[]): Uint8Array {
    const encoder = new TextEncoder()
    const now = dosDateTime(new Date())
    const localParts: Uint8Array[] = []
    const centralParts: Uint8Array[] = []
    let offset = 0

    for (const entry of entries) {
      const nameBytes = encoder.encode(entry.name)
      const crc = crc32(entry.bytes)
      const localHeader = zipLocalHeader(nameBytes, entry.bytes.length, crc, now)
      localParts.push(localHeader, entry.bytes)
      centralParts.push(zipCentralDirectoryHeader(nameBytes, entry.bytes.length, crc, now, offset))
      offset += localHeader.length + entry.bytes.length
    }

    const centralDirectoryOffset = offset
    const centralDirectorySize = centralParts.reduce((sum, part) => sum + part.length, 0)
    return concatBytes([...localParts, ...centralParts, zipEndOfCentralDirectory(entries.length, centralDirectorySize, centralDirectoryOffset)])
  }

  export function uniqueZipEntryName(name: string, usedNames: Set<string>): string {
    const safeName = safeAttachmentFileName(name)
    if (!usedNames.has(safeName)) {
      usedNames.add(safeName)
      return safeName
    }
    const dot = safeName.lastIndexOf(".")
    const base = dot <= 0 ? safeName : safeName.slice(0, dot)
    const ext = dot <= 0 ? "" : safeName.slice(dot)
    for (let index = 2; ; index += 1) {
      const candidate = `${base} (${index})${ext}`
      if (!usedNames.has(candidate)) {
        usedNames.add(candidate)
        return candidate
      }
    }
  }

  export function safeBaseFileName(name: string): string {
    return name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").replace(/\s+/g, " ").trim().slice(0, 160)
  }

  function blobLikeToObjectUrl(blob: BlobLike, type: string): string {
    if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") throw new Error("Attachment opening is only available in a browser.")
    return URL.createObjectURL(blobLikeToBlob(blob, type))
  }

  function openBlobInNewTab(blob: Blob): void {
    const objectUrl = blobLikeToObjectUrl(blob, blob.type)
    if (typeof globalThis.open !== "function") {
      URL.revokeObjectURL(objectUrl)
      throw new Error("Attachment opening is only available in a browser.")
    }
    const opened = globalThis.open(objectUrl, "_blank", "noopener,noreferrer")
    if (opened === null) {
      URL.revokeObjectURL(objectUrl)
      throw new Error("Attachment popup was blocked.")
    }
    globalThis.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000)
  }

  function saveFilePickerTypes(name: string, type: string): readonly { readonly description: string; readonly accept: Record<string, readonly string[]> }[] | undefined {
    if (type.length === 0 || type === "application/octet-stream") return undefined
    const extension = fileExtension(name)
    return [{ description: type, accept: { [type]: extension === undefined ? [] : [extension] } }]
  }

  function fileExtension(name: string): string | undefined {
    const index = name.lastIndexOf(".")
    if (index < 0 || index === name.length - 1) return undefined
    return name.slice(index).toLowerCase()
  }

  class SaveFileCancelledError extends Error {
    constructor() {
      super("Save cancelled")
      this.name = "AbortError"
    }
  }

  function downloadBytesOrBlob(blob: Blob, name: string): void {
    if (typeof document === "undefined" || typeof URL === "undefined" || typeof URL.createObjectURL !== "function") throw new Error("Attachment download is only available in a browser.")
    const objectUrl = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = objectUrl
    link.download = name
    link.rel = "noopener"
    document.body.appendChild(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000)
  }

  function safeAttachmentFileName(name: string): string {
    const cleaned = safeBaseFileName(name)
    return cleaned.length === 0 ? "attachment" : cleaned
  }

  function shouldRetryDownloadAsOctetStream(error: unknown, type: string): boolean {
    return type.toLowerCase() !== "application/octet-stream" && error instanceof JmapTransportError && error.status === 400
  }

  function zipLocalHeader(nameBytes: Uint8Array, size: number, crc: number, now: { readonly time: number; readonly date: number }): Uint8Array {
    const header = new Uint8Array(30 + nameBytes.length)
    const view = new DataView(header.buffer)
    view.setUint32(0, 0x04034b50, true)
    view.setUint16(4, 20, true)
    view.setUint16(6, 0x0800, true)
    view.setUint16(8, 0, true)
    view.setUint16(10, now.time, true)
    view.setUint16(12, now.date, true)
    view.setUint32(14, crc, true)
    view.setUint32(18, size, true)
    view.setUint32(22, size, true)
    view.setUint16(26, nameBytes.length, true)
    header.set(nameBytes, 30)
    return header
  }

  function zipCentralDirectoryHeader(nameBytes: Uint8Array, size: number, crc: number, now: { readonly time: number; readonly date: number }, localHeaderOffset: number): Uint8Array {
    const header = new Uint8Array(46 + nameBytes.length)
    const view = new DataView(header.buffer)
    view.setUint32(0, 0x02014b50, true)
    view.setUint16(4, 20, true)
    view.setUint16(6, 20, true)
    view.setUint16(8, 0x0800, true)
    view.setUint16(10, 0, true)
    view.setUint16(12, now.time, true)
    view.setUint16(14, now.date, true)
    view.setUint32(16, crc, true)
    view.setUint32(20, size, true)
    view.setUint32(24, size, true)
    view.setUint16(28, nameBytes.length, true)
    view.setUint32(42, localHeaderOffset, true)
    header.set(nameBytes, 46)
    return header
  }

  function zipEndOfCentralDirectory(entryCount: number, centralDirectorySize: number, centralDirectoryOffset: number): Uint8Array {
    const header = new Uint8Array(22)
    const view = new DataView(header.buffer)
    view.setUint32(0, 0x06054b50, true)
    view.setUint16(8, entryCount, true)
    view.setUint16(10, entryCount, true)
    view.setUint32(12, centralDirectorySize, true)
    view.setUint32(16, centralDirectoryOffset, true)
    return header
  }

  function dosDateTime(date: Date): { readonly time: number; readonly date: number } {
    const year = Math.max(1980, date.getFullYear())
    return {
      time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
      date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    }
  }

  function crc32(bytes: Uint8Array): number {
    let crc = 0xffffffff
    for (const byte of bytes) crc = (CRC32_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8)
    return (crc ^ 0xffffffff) >>> 0
  }

  const CRC32_TABLE: readonly number[] = Array.from({ length: 256 }, (_value, index) => {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    return value >>> 0
  })

  function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
    const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
    let offset = 0
    for (const part of parts) {
      output.set(part, offset)
      offset += part.length
    }
    return output
  }

  function bufferSource(bytes: Uint8Array): ArrayBuffer {
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  }

  function isTauriRuntime(): boolean {
    if (tauriRuntimeAvailable()) return true
    const runtime = globalThis as typeof globalThis & { readonly __TAURI_INTERNALS__?: unknown; readonly __TAURI__?: unknown; readonly isTauri?: unknown }
    return runtime.__TAURI_INTERNALS__ !== undefined || runtime.__TAURI__ !== undefined || runtime.isTauri === true
  }
}
