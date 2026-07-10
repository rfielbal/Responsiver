#!/usr/bin/env node

import { fileURLToPath } from 'node:url'
import {
  NativeMessageDecoder,
  PROTOCOL_VERSION,
  ProtocolError,
  encodeNativeMessage,
  validateOpenUrlRequest
} from './protocol.mjs'
import { SpoolError, persistOpenUrlRequest } from './spool.mjs'

function errorResponse(error, requestId = null) {
  const knownError = error instanceof ProtocolError || error instanceof SpoolError
  return {
    version: PROTOCOL_VERSION,
    requestId,
    ok: false,
    error: {
      code: knownError ? error.code : 'INTERNAL_ERROR',
      message: knownError ? error.message : 'Le connecteur local a rencontré une erreur inattendue.'
    }
  }
}

export async function handleNativeRequest(rawRequest, options = {}) {
  let requestId = null
  try {
    if (rawRequest && typeof rawRequest.requestId === 'string' && rawRequest.requestId.length <= 64) {
      requestId = rawRequest.requestId
    }
    const request = validateOpenUrlRequest(rawRequest)
    const persisted = await persistOpenUrlRequest(request, options)
    return {
      version: PROTOCOL_VERSION,
      requestId: request.requestId,
      ok: true,
      validated: true,
      delivery: 'queued',
      desktopAcknowledged: false,
      spoolId: persisted.spoolId
    }
  } catch (error) {
    return errorResponse(error, requestId)
  }
}

async function writeFramedMessage(stream, value) {
  const framed = encodeNativeMessage(value)
  if (stream.write(framed)) return
  await new Promise((resolve) => stream.once('drain', resolve))
}

export async function runNativeHost({ input = process.stdin, output = process.stdout, inboxPath } = {}) {
  const decoder = new NativeMessageDecoder()

  try {
    for await (const chunk of input) {
      const messages = decoder.push(chunk)
      for (const message of messages) {
        const response = await handleNativeRequest(message, inboxPath ? { inboxPath } : undefined)
        await writeFramedMessage(output, response)
      }
    }
    decoder.finish()
  } catch (error) {
    await writeFramedMessage(output, errorResponse(error)).catch(() => undefined)
    process.exitCode = 1
  }
}

const isEntryPoint = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (isEntryPoint) {
  await runNativeHost()
}
