export namespace Binary {
  export function randomBytes(length: number): Uint8Array {
    const bytes = new Uint8Array(length)
    crypto.getRandomValues(bytes)
    return bytes
  }

  export function bytesToBase64(bytes: Uint8Array): string {
    return btoa(String.fromCharCode(...bytes))
  }

  export function base64ToBytes(value: string): Uint8Array {
    return Uint8Array.from(atob(value), (char) => char.charCodeAt(0))
  }

  export function bufferSource(bytes: Uint8Array): ArrayBuffer {
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  }
}
