/*
 * Responsiver Chrome companion
 * SPDX-License-Identifier: Apache-2.0
 *
 * This worker deliberately has no host permission. It receives the active tab
 * only after an explicit click on the extension action and forwards a bounded,
 * validated message to the local native host.
 */

const NATIVE_HOST = 'fr.responsiver.desktop'
const PROTOCOL_VERSION = 1
const MAX_URL_LENGTH = 8192
const MAX_TITLE_LENGTH = 256

const ERROR_CODES = Object.freeze({
  APP_UNAVAILABLE: 'APP_UNAVAILABLE',
  FORBIDDEN_URL: 'FORBIDDEN_URL',
  INVALID_TAB: 'INVALID_TAB',
  NATIVE_ERROR: 'NATIVE_ERROR',
  PROTOCOL_ERROR: 'PROTOCOL_ERROR'
})

function createRequestId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()

  const bytes = new Uint8Array(16)
  globalThis.crypto.getRandomValues(bytes)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function normalizeTitle(value) {
  if (typeof value !== 'string') return ''
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE_LENGTH)
}

function normalizeUrl(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_URL_LENGTH) return null

  try {
    const parsed = new URL(value)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    if (parsed.username || parsed.password) return null
    return parsed.href
  } catch {
    return null
  }
}

function toBoundedInteger(value, fallback, minimum, maximum) {
  return Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, Math.round(value))) : fallback
}

function buildNativeRequest(tab, devicePixelRatio) {
  const url = normalizeUrl(tab?.url)
  if (!url) {
    return {
      ok: false,
      error: {
        code: ERROR_CODES.FORBIDDEN_URL,
        message: 'Seules les pages HTTP et HTTPS peuvent être ouvertes.'
      }
    }
  }

  const requestId = createRequestId()
  return {
    ok: true,
    request: {
      version: PROTOCOL_VERSION,
      type: 'open-url',
      requestId,
      sentAt: new Date().toISOString(),
      source: 'chrome-extension',
      payload: {
        url,
        title: normalizeTitle(tab.title),
        viewport: {
          width: toBoundedInteger(tab.width, 1280, 1, 16384),
          height: toBoundedInteger(tab.height, 720, 1, 16384)
        },
        devicePixelRatio: Number.isFinite(devicePixelRatio)
          ? Math.min(8, Math.max(0.5, Math.round(devicePixelRatio * 100) / 100))
          : 1
      }
    }
  }
}

function classifyNativeError(message = '') {
  const normalized = String(message).toLowerCase()
  if (
    normalized.includes('native messaging host not found') ||
    normalized.includes('specified native messaging host') ||
    normalized.includes('access to the specified native messaging host is forbidden')
  ) {
    return {
      code: ERROR_CODES.APP_UNAVAILABLE,
      message: 'Responsiver ou son connecteur local est introuvable.'
    }
  }

  return {
    code: ERROR_CODES.NATIVE_ERROR,
    message: 'Le connecteur local n’a pas pu transmettre la page.'
  }
}

function sendToNativeHost(request) {
  return new Promise((resolve) => {
    chrome.runtime.sendNativeMessage(NATIVE_HOST, request, (response) => {
      const runtimeError = chrome.runtime.lastError
      if (runtimeError) {
        resolve({ ok: false, error: classifyNativeError(runtimeError.message) })
        return
      }

      if (
        !response ||
        response.version !== PROTOCOL_VERSION ||
        response.requestId !== request.requestId ||
        typeof response.ok !== 'boolean'
      ) {
        resolve({
          ok: false,
          error: {
            code: ERROR_CODES.PROTOCOL_ERROR,
            message: 'La réponse du connecteur local est invalide.'
          }
        })
        return
      }

      if (!response.ok) {
        resolve({
          ok: false,
          error: {
            code: typeof response.error?.code === 'string' ? response.error.code : ERROR_CODES.NATIVE_ERROR,
            message:
              typeof response.error?.message === 'string'
                ? response.error.message.slice(0, 240)
                : 'La demande a été refusée par le connecteur local.'
          }
        })
        return
      }

      resolve({
        ok: true,
        result: {
          requestId: request.requestId,
          delivery: response.delivery === 'queued' ? 'queued' : 'accepted'
        }
      })
    })
  })
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== 'OPEN_ACTIVE_TAB') return false

  ;(async () => {
    let tabs
    try {
      tabs = await chrome.tabs.query({ active: true, currentWindow: true })
    } catch {
      sendResponse({
        ok: false,
        error: { code: ERROR_CODES.INVALID_TAB, message: 'Impossible de lire l’onglet actif.' }
      })
      return
    }

    const tab = tabs[0]
    if (!tab) {
      sendResponse({
        ok: false,
        error: { code: ERROR_CODES.INVALID_TAB, message: 'Aucun onglet actif n’a été trouvé.' }
      })
      return
    }

    const built = buildNativeRequest(tab, message.devicePixelRatio)
    if (!built.ok) {
      sendResponse(built)
      return
    }

    sendResponse(await sendToNativeHost(built.request))
  })().catch(() => {
    sendResponse({
      ok: false,
      error: { code: ERROR_CODES.NATIVE_ERROR, message: 'Une erreur locale inattendue est survenue.' }
    })
  })

  return true
})
