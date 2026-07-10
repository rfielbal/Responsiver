import { isIP } from 'node:net'

export type AuditUrlMode = 'public' | 'localhost'

export type AuditUrlPolicyErrorCode =
  | 'empty-url'
  | 'url-too-long'
  | 'invalid-url'
  | 'forbidden-protocol'
  | 'credentials-forbidden'
  | 'public-https-required'
  | 'public-host-required'
  | 'public-host-forbidden'
  | 'localhost-host-required'
  | 'dns-validation-required'
  | 'invalid-address'
  | 'forbidden-address'
  | 'too-many-addresses'

export interface NormalizedAuditUrl {
  mode: AuditUrlMode
  href: string
  origin: string
  protocol: 'http:' | 'https:'
  hostname: string
  port: string
  pathname: string
  search: string
  hash: string
  isIpLiteral: boolean
  resolutionValidated: boolean
}

export interface AuthorizeAuditUrlOptions {
  /**
   * Résultats de la résolution DNS réalisée juste avant la navigation. Toutes
   * les adresses sont contrôlées afin de bloquer les réponses DNS mixtes et le
   * rebinding vers le réseau local.
   */
  resolvedAddresses?: readonly string[]
}

export class AuditUrlPolicyError extends Error {
  readonly code: AuditUrlPolicyErrorCode

  constructor(code: AuditUrlPolicyErrorCode, message: string) {
    super(message)
    this.name = 'AuditUrlPolicyError'
    this.code = code
  }
}

const MAX_URL_LENGTH = 4_096
const MAX_RESOLVED_ADDRESSES = 16
const localHostnameSuffixes = ['.localhost', '.local', '.localdomain', '.internal', '.home', '.lan']

type AddressScope = 'public' | 'loopback' | 'private' | 'link-local' | 'documentation' | 'multicast' | 'reserved'

function fail(code: AuditUrlPolicyErrorCode, message: string): never {
  throw new AuditUrlPolicyError(code, message)
}

function stripIpv6Brackets(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname
}

function parseIpv4(address: string): number[] | null {
  if (isIP(address) !== 4) return null
  const octets = address.split('.').map(Number)
  return octets.length === 4 && octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255)
    ? octets
    : null
}

function classifyIpv4(address: string): AddressScope {
  const octets = parseIpv4(address)
  if (!octets) return 'reserved'
  const [a, b, c, d] = octets

  if (a === 127) return 'loopback'
  if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return 'private'
  if (a === 169 && b === 254) return 'link-local'
  if (a === 100 && b >= 64 && b <= 127) return 'private'
  if (
    (a === 192 && b === 0 && c === 2) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113)
  ) return 'documentation'
  if (a >= 224 && a <= 239) return 'multicast'
  if (
    a === 0 ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 240 ||
    (a === 255 && b === 255 && c === 255 && d === 255)
  ) return 'reserved'
  return 'public'
}

function ipv4ToIpv6Groups(address: string): [string, string] | null {
  const octets = parseIpv4(address)
  if (!octets) return null
  return [
    ((octets[0] << 8) | octets[1]).toString(16),
    ((octets[2] << 8) | octets[3]).toString(16)
  ]
}

function expandIpv6(address: string): number[] | null {
  if (address.includes('%') || isIP(address) !== 6) return null
  let normalized = address.toLowerCase()
  const dottedTail = normalized.match(/(?:^|:)(\d{1,3}(?:\.\d{1,3}){3})$/)?.[1]
  if (dottedTail) {
    const groups = ipv4ToIpv6Groups(dottedTail)
    if (!groups) return null
    normalized = `${normalized.slice(0, normalized.length - dottedTail.length)}${groups[0]}:${groups[1]}`
  }

  const halves = normalized.split('::')
  if (halves.length > 2) return null
  const left = halves[0] ? halves[0].split(':') : []
  const right = halves[1] ? halves[1].split(':') : []
  const missing = 8 - left.length - right.length
  if ((halves.length === 1 && missing !== 0) || missing < 0) return null
  const groups = [...left, ...Array.from({ length: missing }, () => '0'), ...right]
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/i.test(group))) return null
  return groups.map((group) => Number.parseInt(group, 16))
}

function classifyIpv6(address: string): AddressScope {
  const groups = expandIpv6(address)
  if (!groups) return 'reserved'
  const [first, second] = groups
  const allZero = groups.every((group) => group === 0)
  if (allZero) return 'reserved'
  if (groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1) return 'loopback'

  // ::ffff:0:0/96 — les littéraux IPv4 mappés gardent la portée de l'IPv4.
  if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff) {
    const mapped = `${groups[6] >> 8}.${groups[6] & 0xff}.${groups[7] >> 8}.${groups[7] & 0xff}`
    return classifyIpv4(mapped)
  }
  if ((first & 0xfe00) === 0xfc00) return 'private'
  if ((first & 0xffc0) === 0xfe80) return 'link-local'
  if ((first & 0xff00) === 0xff00) return 'multicast'
  // N'autoriser que l'espace global unicast actuellement assigné. Cette règle
  // refuse notamment les préfixes NAT64 (qui pourraient encoder une IPv4
  // privée), discard-only et les futures plages encore réservées.
  if ((first & 0xe000) !== 0x2000) return 'reserved'
  // 2001:0000::/23 contient des affectations de protocoles spéciaux, pas des
  // destinations web ordinaires. 2002::/16 (6to4) peut également encapsuler
  // une IPv4 non publique et ne doit pas contourner la politique SSRF.
  if (first === 0x2001 && second <= 0x01ff) return 'reserved'
  if (first === 0x2002) return 'reserved'
  if (first === 0x2001 && second === 0x0db8) return 'documentation'
  if ((first & 0xfff0) === 0x3ff0) return 'documentation'
  if ((first & 0xffc0) === 0xfec0) return 'reserved'
  return 'public'
}

export function classifyIpAddress(address: string): AddressScope {
  const normalized = stripIpv6Brackets(address.trim())
  if (isIP(normalized) === 4) return classifyIpv4(normalized)
  if (isIP(normalized) === 6) return classifyIpv6(normalized)
  return 'reserved'
}

function isLocalHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/, '')
  if (normalized === 'localhost') return true
  if (normalized.endsWith('.localhost')) return true
  if (isIP(normalized)) return classifyIpAddress(normalized) === 'loopback'
  return false
}

function isForbiddenPublicHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/, '')
  if (!normalized || normalized === 'localhost') return true
  if (localHostnameSuffixes.some((suffix) => normalized.endsWith(suffix))) return true
  // Un nom sans point dépend du DNS/search-domain local de la machine.
  return !normalized.includes('.') && isIP(normalized) === 0
}

function withDefaultProtocol(input: string, mode: AuditUrlMode): string {
  if (/^[a-z][a-z\d+.-]*:/i.test(input)) return input
  return `${mode === 'public' ? 'https' : 'http'}://${input}`
}

export function normalizeAuditUrl(input: string, mode: AuditUrlMode): NormalizedAuditUrl {
  const trimmed = input.trim()
  if (!trimmed) fail('empty-url', 'L’URL est vide.')
  if (trimmed.length > MAX_URL_LENGTH) fail('url-too-long', 'L’URL dépasse la taille autorisée.')
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) fail('invalid-url', 'L’URL contient des caractères de contrôle.')

  let url: URL
  try {
    url = new URL(withDefaultProtocol(trimmed, mode))
  } catch {
    fail('invalid-url', 'L’URL est invalide.')
  }

  if (url.username || url.password) fail('credentials-forbidden', 'Les identifiants intégrés dans une URL sont refusés.')
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    fail('forbidden-protocol', 'Seules les URL HTTP(S) sont autorisées.')
  }

  const hostname = stripIpv6Brackets(url.hostname).toLowerCase().replace(/\.$/, '')
  if (!hostname) fail(mode === 'public' ? 'public-host-required' : 'localhost-host-required', 'Un hôte est requis.')
  const ipVersion = isIP(hostname)

  if (mode === 'public') {
    if (url.protocol !== 'https:') fail('public-https-required', 'Les audits publics exigent HTTPS.')
    if (isForbiddenPublicHostname(hostname)) fail('public-host-forbidden', 'Cet hôte local ou ambigu est refusé en mode public.')
    if (ipVersion && classifyIpAddress(hostname) !== 'public') {
      fail('forbidden-address', 'Cette adresse IP n’est pas publique.')
    }
  } else if (!isLocalHostname(hostname)) {
    fail('localhost-host-required', 'Le mode localhost accepte uniquement localhost et les adresses de boucle locale.')
  }

  // URL normalise le port par défaut et l'encodage, sans supprimer le hash
  // utilisé par de nombreux routeurs SPA.
  url.hostname = hostname
  const exactLocalhost = hostname === 'localhost'
  return {
    mode,
    href: url.href,
    origin: url.origin,
    protocol: url.protocol as 'http:' | 'https:',
    hostname,
    port: url.port,
    pathname: url.pathname,
    search: url.search,
    hash: url.hash,
    isIpLiteral: ipVersion !== 0,
    resolutionValidated: ipVersion !== 0 || exactLocalhost
  }
}

export function validateAuditUrlResolution(
  normalized: NormalizedAuditUrl,
  resolvedAddresses: readonly string[]
): NormalizedAuditUrl {
  if (resolvedAddresses.length === 0) fail('dns-validation-required', 'La résolution DNS doit être vérifiée avant la navigation.')
  if (resolvedAddresses.length > MAX_RESOLVED_ADDRESSES) fail('too-many-addresses', 'La réponse DNS contient trop d’adresses.')

  for (const address of resolvedAddresses) {
    const cleanAddress = stripIpv6Brackets(address.trim())
    if (isIP(cleanAddress) === 0) fail('invalid-address', 'La résolution DNS contient une adresse invalide.')
    const scope = classifyIpAddress(cleanAddress)
    const accepted = normalized.mode === 'public' ? scope === 'public' : scope === 'loopback'
    if (!accepted) {
      fail(
        'forbidden-address',
        normalized.mode === 'public'
          ? 'La résolution DNS pointe vers une adresse non publique.'
          : 'La résolution localhost pointe hors de la boucle locale.'
      )
    }
  }

  return { ...normalized, resolutionValidated: true }
}

/**
 * Seule cette fonction (ou authorizeAuditRedirect) doit être utilisée juste
 * avant un chargement réseau. normalizeAuditUrl convient à la saisie et à
 * l'affichage, mais ne remplace pas la validation DNS anti-SSRF.
 */
export function authorizeAuditUrl(
  input: string,
  mode: AuditUrlMode,
  options: AuthorizeAuditUrlOptions = {}
): NormalizedAuditUrl {
  const normalized = normalizeAuditUrl(input, mode)
  if (normalized.resolutionValidated) {
    if (options.resolvedAddresses?.length) return validateAuditUrlResolution(normalized, options.resolvedAddresses)
    return normalized
  }
  if (!options.resolvedAddresses) fail('dns-validation-required', 'La résolution DNS doit être vérifiée avant la navigation.')
  return validateAuditUrlResolution(normalized, options.resolvedAddresses)
}

/** Revalide le protocole, l'hôte et la résolution DNS à chaque redirection. */
export function authorizeAuditRedirect(
  current: NormalizedAuditUrl,
  location: string,
  options: AuthorizeAuditUrlOptions = {}
): NormalizedAuditUrl {
  let target: string
  try {
    target = new URL(location, current.href).href
  } catch {
    fail('invalid-url', 'La cible de redirection est invalide.')
  }
  return authorizeAuditUrl(target, current.mode, options)
}

/** Politique réseau secondaire de la partition distante, indépendante du DNS. */
export function isAuditResourceRequestAllowed(mode: AuditUrlMode, protocol: string, method: string): boolean {
  const normalizedProtocol = protocol.toLowerCase()
  if (normalizedProtocol === 'data:' || normalizedProtocol === 'blob:' || normalizedProtocol === 'about:') return true
  if (mode === 'public') {
    if (normalizedProtocol !== 'https:' && normalizedProtocol !== 'wss:') return false
    return ['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase())
  }
  return ['http:', 'https:', 'ws:', 'wss:'].includes(normalizedProtocol)
}
