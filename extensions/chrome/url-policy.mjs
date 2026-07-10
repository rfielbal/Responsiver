const MAX_URL_LENGTH = 8192

function normalizedHostname(url) {
  return url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
}

function isLoopbackHostname(hostname) {
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === '::1') return true
  const octets = hostname.split('.')
  return octets.length === 4 && octets.every((octet) => /^\d{1,3}$/.test(octet) && Number(octet) <= 255) && Number(octets[0]) === 127
}

/**
 * Politique du compagnon, volontairement plus restrictive que le framing :
 * HTTPS pour Internet, HTTP(S) uniquement sur la boucle locale.
 */
export function normalizeCompanionUrl(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_URL_LENGTH || /[\u0000-\u001f\u007f]/.test(value)) return null

  try {
    const parsed = new URL(value)
    if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || parsed.username || parsed.password) return null
    if (parsed.protocol === 'http:' && !isLoopbackHostname(normalizedHostname(parsed))) return null
    return parsed.href.length <= MAX_URL_LENGTH ? parsed.href : null
  } catch {
    return null
  }
}
