import { TextDecoder } from 'node:util'

export const PROTOCOL_VERSION = 1
export const MAX_MESSAGE_BYTES = 64 * 1024
export const MAX_URL_LENGTH = 8192
export const MAX_TITLE_LENGTH = 256

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/

export class ProtocolError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'ProtocolError'
    this.code = code
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function hasExactKeys(value, expectedKeys) {
  if (!isPlainObject(value)) return false
  const keys = Object.keys(value).sort()
  return keys.length === expectedKeys.length && keys.every((key, index) => key === expectedKeys[index])
}

function normalizeTitle(value) {
  if (typeof value !== 'string' || value.length > MAX_TITLE_LENGTH || CONTROL_CHARACTERS.test(value)) {
    throw new ProtocolError('INVALID_TITLE', 'Le titre de la page est invalide.')
  }
  return value.replace(/\s+/g, ' ').trim()
}

function normalizeUrl(value) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_URL_LENGTH ||
    CONTROL_CHARACTERS.test(value)
  ) {
    throw new ProtocolError('INVALID_URL', 'L’URL est invalide.')
  }

  let parsed
  try {
    parsed = new URL(value)
  } catch {
    throw new ProtocolError('INVALID_URL', 'L’URL est invalide.')
  }

  if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || parsed.username || parsed.password) {
    throw new ProtocolError('FORBIDDEN_URL', 'Seules les URL HTTP et HTTPS sans identifiants sont acceptées.')
  }

  if (parsed.href.length > MAX_URL_LENGTH) {
    throw new ProtocolError('INVALID_URL', 'L’URL est trop longue.')
  }

  return parsed.href
}

function validateViewport(value) {
  if (!hasExactKeys(value, ['height', 'width'])) {
    throw new ProtocolError('INVALID_VIEWPORT', 'Les dimensions de la page sont invalides.')
  }

  if (
    !Number.isInteger(value.width) ||
    !Number.isInteger(value.height) ||
    value.width < 1 ||
    value.width > 16384 ||
    value.height < 1 ||
    value.height > 16384
  ) {
    throw new ProtocolError('INVALID_VIEWPORT', 'Les dimensions de la page sont hors limites.')
  }

  return { width: value.width, height: value.height }
}

export function validateOpenUrlRequest(value) {
  if (!hasExactKeys(value, ['payload', 'requestId', 'sentAt', 'source', 'type', 'version'])) {
    throw new ProtocolError('INVALID_SCHEMA', 'La structure de la demande est invalide.')
  }

  if (value.version !== PROTOCOL_VERSION || value.type !== 'open-url' || value.source !== 'chrome-extension') {
    throw new ProtocolError('UNSUPPORTED_REQUEST', 'Cette demande n’est pas prise en charge.')
  }

  if (typeof value.requestId !== 'string' || !UUID_PATTERN.test(value.requestId)) {
    throw new ProtocolError('INVALID_REQUEST_ID', 'L’identifiant de la demande est invalide.')
  }

  if (typeof value.sentAt !== 'string' || value.sentAt.length > 40 || !Number.isFinite(Date.parse(value.sentAt))) {
    throw new ProtocolError('INVALID_TIMESTAMP', 'La date de la demande est invalide.')
  }

  if (!hasExactKeys(value.payload, ['devicePixelRatio', 'title', 'url', 'viewport'])) {
    throw new ProtocolError('INVALID_SCHEMA', 'Le contenu de la demande est invalide.')
  }

  const devicePixelRatio = value.payload.devicePixelRatio
  if (!Number.isFinite(devicePixelRatio) || devicePixelRatio < 0.5 || devicePixelRatio > 8) {
    throw new ProtocolError('INVALID_DPR', 'La densité de pixels est invalide.')
  }

  return {
    version: PROTOCOL_VERSION,
    type: 'open-url',
    requestId: value.requestId,
    sentAt: new Date(value.sentAt).toISOString(),
    source: 'chrome-extension',
    payload: {
      url: normalizeUrl(value.payload.url),
      title: normalizeTitle(value.payload.title),
      viewport: validateViewport(value.payload.viewport),
      devicePixelRatio: Math.round(devicePixelRatio * 100) / 100
    }
  }
}

export function encodeNativeMessage(value) {
  const body = Buffer.from(JSON.stringify(value), 'utf8')
  if (body.length > MAX_MESSAGE_BYTES) {
    throw new ProtocolError('MESSAGE_TOO_LARGE', 'Le message dépasse la taille maximale autorisée.')
  }

  const header = Buffer.allocUnsafe(4)
  header.writeUInt32LE(body.length, 0)
  return Buffer.concat([header, body])
}

export class NativeMessageDecoder {
  #buffer = Buffer.alloc(0)
  #decoder = new TextDecoder('utf-8', { fatal: true })

  push(chunk) {
    if (!Buffer.isBuffer(chunk)) chunk = Buffer.from(chunk)
    this.#buffer = this.#buffer.length === 0 ? chunk : Buffer.concat([this.#buffer, chunk])

    const messages = []
    while (this.#buffer.length >= 4) {
      const bodyLength = this.#buffer.readUInt32LE(0)
      if (bodyLength === 0 || bodyLength > MAX_MESSAGE_BYTES) {
        throw new ProtocolError('MESSAGE_TOO_LARGE', 'La taille du message natif est invalide.')
      }
      if (this.#buffer.length < bodyLength + 4) break

      const body = this.#buffer.subarray(4, bodyLength + 4)
      this.#buffer = this.#buffer.subarray(bodyLength + 4)

      let decoded
      try {
        decoded = this.#decoder.decode(body)
      } catch {
        throw new ProtocolError('INVALID_ENCODING', 'Le message natif n’est pas un texte UTF-8 valide.')
      }

      try {
        messages.push(JSON.parse(decoded))
      } catch {
        throw new ProtocolError('INVALID_JSON', 'Le message natif ne contient pas de JSON valide.')
      }
    }

    return messages
  }

  finish() {
    if (this.#buffer.length !== 0) {
      throw new ProtocolError('TRUNCATED_MESSAGE', 'Le message natif est incomplet.')
    }
  }
}
