import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AuditUrlPolicyError,
  authorizeAuditRedirect,
  authorizeAuditUrl,
  classifyIpAddress,
  isAuditResourceRequestAllowed,
  normalizeAuditUrl,
  validateAuditUrlResolution
} from '../src/main/url-policy.ts'
import {
  REMOTE_AUDIT_BOOTSTRAP_SCRIPT,
  buildRemoteAuditScript,
  consolidateRemoteAuditFindings,
  sanitizeRemoteAuditResult
} from '../src/main/remote-audit.ts'

function assertPolicyError(action: () => unknown, code: AuditUrlPolicyError['code']): void {
  assert.throws(action, (error: unknown) => error instanceof AuditUrlPolicyError && error.code === code)
}

test('la politique sépare strictement URL publique et localhost', () => {
  const publicUrl = normalizeAuditUrl('example.com/parcours?mode=mobile#section', 'public')
  assert.equal(publicUrl.href, 'https://example.com/parcours?mode=mobile#section')
  assert.equal(publicUrl.resolutionValidated, false)
  assert.equal(normalizeAuditUrl('http://localhost:5173/app', 'localhost').href, 'http://localhost:5173/app')
  assert.equal(normalizeAuditUrl('https://[::1]:8443/', 'localhost').hostname, '::1')

  assertPolicyError(() => normalizeAuditUrl('http://example.com', 'public'), 'public-https-required')
  assertPolicyError(() => normalizeAuditUrl('file:///etc/passwd', 'public'), 'forbidden-protocol')
  assertPolicyError(() => normalizeAuditUrl('https://user:secret@example.com', 'public'), 'credentials-forbidden')
  assertPolicyError(() => normalizeAuditUrl('https://localhost:8443', 'public'), 'public-host-forbidden')
  assertPolicyError(() => normalizeAuditUrl('https://intranet', 'public'), 'public-host-forbidden')
  assertPolicyError(() => normalizeAuditUrl('https://example.com', 'localhost'), 'localhost-host-required')
})

test('les plages privées, spéciales et IPv4 mappées sont bloquées', () => {
  assert.equal(classifyIpAddress('8.8.8.8'), 'public')
  assert.equal(classifyIpAddress('10.0.0.1'), 'private')
  assert.equal(classifyIpAddress('169.254.169.254'), 'link-local')
  assert.equal(classifyIpAddress('203.0.113.2'), 'documentation')
  assert.equal(classifyIpAddress('127.0.0.2'), 'loopback')
  assert.equal(classifyIpAddress('::1'), 'loopback')
  assert.equal(classifyIpAddress('fc00::1'), 'private')
  assert.equal(classifyIpAddress('::ffff:127.0.0.1'), 'loopback')
  assert.equal(classifyIpAddress('::2'), 'reserved')
  assert.equal(classifyIpAddress('64:ff9b::c0a8:101'), 'reserved')
  assert.equal(classifyIpAddress('2002:c0a8:101::1'), 'reserved')
  assert.equal(classifyIpAddress('2606:4700:4700::1111'), 'public')

  for (const address of ['10.0.0.2', '127.0.0.1', '169.254.169.254', '192.168.1.1', '::1', 'fc00::1']) {
    assertPolicyError(() => normalizeAuditUrl(`https://${address.includes(':') ? `[${address}]` : address}`, 'public'), 'forbidden-address')
  }
})

test('la résolution DNS et chaque redirection sont revalidées', () => {
  const normalized = normalizeAuditUrl('https://example.com', 'public')
  assertPolicyError(() => authorizeAuditUrl(normalized.href, 'public'), 'dns-validation-required')
  assertPolicyError(() => validateAuditUrlResolution(normalized, ['93.184.216.34', '127.0.0.1']), 'forbidden-address')

  const authorized = authorizeAuditUrl(normalized.href, 'public', { resolvedAddresses: ['93.184.216.34'] })
  assert.equal(authorized.resolutionValidated, true)
  const redirected = authorizeAuditRedirect(authorized, '/nouvelle-route', { resolvedAddresses: ['93.184.216.34'] })
  assert.equal(redirected.href, 'https://example.com/nouvelle-route')
  assertPolicyError(
    () => authorizeAuditRedirect(authorized, 'https://localhost/admin', { resolvedAddresses: ['127.0.0.1'] }),
    'public-host-forbidden'
  )

  const local = authorizeAuditUrl('http://localhost:3000', 'localhost')
  assert.equal(authorizeAuditRedirect(local, '/connexion').href, 'http://localhost:3000/connexion')
  assertPolicyError(() => authorizeAuditRedirect(local, 'https://example.com'), 'localhost-host-required')
})

test('le mode public reste en lecture seule et le localhost conserve ses protocoles de développement', () => {
  assert.equal(isAuditResourceRequestAllowed('public', 'https:', 'GET'), true)
  assert.equal(isAuditResourceRequestAllowed('public', 'wss:', 'GET'), true)
  assert.equal(isAuditResourceRequestAllowed('public', 'https:', 'POST'), false)
  assert.equal(isAuditResourceRequestAllowed('public', 'http:', 'GET'), false)
  assert.equal(isAuditResourceRequestAllowed('public', 'ws:', 'GET'), false)
  assert.equal(isAuditResourceRequestAllowed('localhost', 'http:', 'POST'), true)
  assert.equal(isAuditResourceRequestAllowed('localhost', 'ws:', 'GET'), true)
  assert.equal(isAuditResourceRequestAllowed('localhost', 'file:', 'GET'), false)
  assert.equal(isAuditResourceRequestAllowed('public', 'blob:', 'GET'), true)
})

test('le script d’audit est borné et contient les détecteurs attendus', () => {
  assert.match(REMOTE_AUDIT_BOOTSTRAP_SCRIPT, /unhandledrejection/)
  const script = buildRemoteAuditScript({ maxNodes: 999_999, maxFindings: 999_999, maxRuntimeErrors: 999 })
  assert.doesNotThrow(() => new Function(REMOTE_AUDIT_BOOTSTRAP_SCRIPT))
  assert.doesNotThrow(() => new Function(script))
  assert.doesNotMatch(script, /__RESPONSIVER_OPTIONS__/)
  assert.match(script, /"maxNodes":5000/)
  assert.match(script, /"maxFindings":320/)
  assert.match(script, /createTreeWalker/)
  assert.doesNotMatch(script, /querySelectorAll\(['"]\*['"]\)/)
  for (const rule of [
    'responsive.missing-viewport',
    'layout.viewport-overflow',
    'layout.clipped-content',
    'layout.truncated-text',
    'layout.navigation-wrap',
    'layout.element-overlap',
    'layout.density-hierarchy',
    'layout.useful-area-overflow',
    'typography.disproportionate',
    'typography.mobile-readability',
    'interaction.small-target',
    'layout.fixed-obstruction',
    'media.image-error',
    'media.image-distortion',
    'accessibility.low-contrast',
    'runtime.page-error'
  ]) assert.match(script, new RegExp(rule.replace('.', '\\.')))

  const mobileScript = buildRemoteAuditScript({ mobile: true, touch: true, expectedViewportWidth: 390 })
  assert.match(mobileScript, /"mobile":true/)
  assert.match(mobileScript, /"touch":true/)
  assert.match(mobileScript, /"expectedViewportWidth":390/)
  assert.match(mobileScript, /meta\[name="viewport" i\]/)
  assert.match(mobileScript, /fontSize < 12/)
})

test('les doublons multi-viewport gardent une seule preuve, la plus sévère', () => {
  const first = sanitizeRemoteAuditResult({ findings: [{
    rule: 'layout.viewport-overflow', title: 'Débordement', description: 'Petit', selector: '#hero',
    rect: { x: 0, y: 0, width: 410, height: 100 }, style: {},
    evidence: [{ kind: 'geometry', summary: 'Dépassement', observed: 20, expected: 0 }], confidence: .8
  }] }, { url: 'https://example.com/page', viewport: { width: 390, height: 844 } })
  const second = sanitizeRemoteAuditResult({ findings: [{
    rule: 'layout.viewport-overflow', title: 'Débordement', description: 'Fort', selector: '#hero',
    rect: { x: -40, y: 0, width: 460, height: 100 }, style: {},
    evidence: [{ kind: 'geometry', summary: 'Dépassement', observed: 100, expected: 0 }], confidence: .94
  }] }, { url: 'https://example.com/page', viewport: { width: 320, height: 720 } })

  const grouped = consolidateRemoteAuditFindings([...first.findings, ...second.findings])
  assert.equal(grouped.length, 1)
  assert.equal(grouped[0]?.finding.description, 'Fort')
  assert.deepEqual(grouped[0]?.viewports.map(({ width, height }) => [width, height]), [[320, 720], [390, 844]])
})

test('les constats mobile conservent preuves et niveau heuristique après assainissement', () => {
  const result = sanitizeRemoteAuditResult({
    scannedNodes: 12,
    findings: [
      {
        rule: 'responsive.missing-viewport',
        title: 'Viewport absent',
        description: 'Diagnostic',
        selector: ':root',
        rect: { x: 0, y: 0, width: 980, height: 800 },
        style: {},
        evidence: [{ kind: 'geometry', summary: 'Largeur observée', observed: 980, expected: 390 }],
        confidence: 0.99
      },
      {
        rule: 'typography.mobile-readability',
        title: 'Petit texte',
        description: 'Diagnostic',
        selector: 'main > p',
        rect: { x: 10, y: 20, width: 300, height: 40 },
        style: { fontSize: '11px', lineHeight: '12px' },
        evidence: [{ kind: 'style', summary: 'Taille du texte', observed: '11 px', expected: 'au moins 12 px' }],
        confidence: 0.78
      }
    ]
  }, {
    url: 'https://example.com/',
    viewport: { width: 390, height: 844, deviceScaleFactor: 3 }
  })

  assert.equal(result.findings[0]?.severity, 'error')
  assert.equal(result.findings[0]?.category, 'layout')
  assert.deepEqual(result.findings[0]?.evidence[0], { kind: 'geometry', summary: 'Largeur observée', observed: 980, expected: 390 })
  assert.equal(result.findings[1]?.severity, 'warning')
  assert.equal(result.findings[1]?.category, 'accessibility')
  assert.deepEqual(result.findings[1]?.style, { fontSize: '11px', lineHeight: '12px' })
})

test('le résultat d’une page est assaini et rattaché au contexte approuvé', () => {
  const result = sanitizeRemoteAuditResult({
    version: 99,
    route: { url: 'https://attacker.invalid/private' },
    viewport: { width: 999_999, height: 999_999 },
    scannedNodes: 99_999_999,
    truncated: false,
    findings: [
      {
        id: 'forged',
        rule: 'layout.viewport-overflow',
        category: 'runtime',
        severity: 'info',
        title: `Débordement\u0000${'x'.repeat(1_000)}`,
        description: 'Description',
        selector: '#hero',
        rect: { x: -Infinity, y: 12, width: 300, height: 40 },
        style: { minWidth: '900px', secret: 'ne doit pas sortir' },
        evidence: [{ kind: 'geometry', summary: 'Dépassement', observed: 200, expected: 0 }],
        confidence: 42
      },
      { rule: 'custom.injection', selector: '*', title: 'inconnu' }
    ]
  }, {
    url: 'https://example.com/page?audit=1#hero',
    viewport: { width: 390, height: 844, deviceScaleFactor: 3 },
    maxScannedNodes: 2_500
  })

  assert.equal(result.version, 1)
  assert.deepEqual(result.route, {
    url: 'https://example.com/page?audit=1#hero',
    pathname: '/page',
    path: '/page?audit=1#hero'
  })
  assert.deepEqual(result.viewport, { width: 390, height: 844, deviceScaleFactor: 3 })
  assert.equal(result.scannedNodes, 2_500)
  assert.equal(result.maxNodes, 2_500)
  assert.equal(result.maxFindings, 180)
  assert.equal(result.truncated, false)
  assert.equal(result.findings.length, 1)
  const finding = result.findings[0]
  assert.equal(finding.category, 'layout')
  assert.equal(finding.severity, 'error')
  assert.equal(finding.confidence, 1)
  assert.equal(finding.rect.x, 0)
  assert.deepEqual(finding.style, { minWidth: '900px' })
  assert.ok(finding.title.length <= 280)
  assert.match(finding.id, /^remote-[0-9a-f]{8}$/)
})
