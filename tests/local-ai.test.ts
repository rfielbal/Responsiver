import assert from 'node:assert/strict'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import test from 'node:test'
import { normalizeLocalAiEndpoint, probeLocalAi, sendLocalAiRequest } from '../src/main/local-ai.ts'

async function withServer(handler: (request: IncomingMessage, response: ServerResponse) => void): Promise<{ endpoint: string; close: () => Promise<void> }> {
  const server = createServer(handler)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Adresse de test indisponible.')
  return {
    endpoint: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
}

test('le moteur IA refuse toute adresse qui ne reste pas sur la boucle locale', () => {
  assert.equal(normalizeLocalAiEndpoint('http://127.0.0.1:11434/'), 'http://127.0.0.1:11434')
  assert.equal(normalizeLocalAiEndpoint('http://localhost:11434/'), 'http://127.0.0.1:11434')
  assert.equal(normalizeLocalAiEndpoint('http://[::1]:8080/'), 'http://[::1]:8080')
  assert.throws(() => normalizeLocalAiEndpoint('https://api.example.com'), /uniquement une adresse HTTP loopback/)
  assert.throws(() => normalizeLocalAiEndpoint('http://user:secret@localhost:11434'), /identifiant/)
  assert.throws(() => normalizeLocalAiEndpoint('file:///tmp/model'), /uniquement une adresse HTTP loopback/)
})

test('une requête IA au contexte mal formé est refusée avant tout accès réseau', async () => {
  await assert.rejects(sendLocalAiRequest({
    provider: 'ollama',
    endpoint: 'http://127.0.0.1:11434',
    model: 'local',
    prompt: 'Analyse.',
    context: { projectName: 'Projet', sourceKind: 'local-project', route: '/', findings: 'invalide' }
  }), /incomplète ou trop volumineuse/)
})

test('la détection Ollama reste locale et borne la liste des modèles', async (context) => {
  const fixture = await withServer((request, response) => {
    assert.equal(request.url, '/api/tags')
    assert.equal(request.headers.origin, undefined, 'la requête part du main process, pas du navigateur')
    response.setHeader('content-type', 'application/json')
    assert.equal(response.hasHeader('access-control-allow-origin'), false, 'le moteur factice ne fournit volontairement aucun CORS')
    response.end(JSON.stringify({ models: [{ name: 'vision-local:latest' }, { model: 'code-local:7b' }] }))
  })
  context.after(fixture.close)
  const status = await probeLocalAi('ollama', fixture.endpoint)
  assert.equal(status.available, true)
  assert.equal(status.code, 'ready')
  assert.equal(status.action, null)
  assert.deepEqual(status.models, ['vision-local:latest', 'code-local:7b'])
})

test('localhost vise explicitement IPv4 et fonctionne sans configuration CORS', async (context) => {
  const fixture = await withServer((_request, response) => {
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({ models: [] }))
  })
  context.after(fixture.close)
  const endpoint = fixture.endpoint.replace('127.0.0.1', 'localhost')
  const status = await probeLocalAi('ollama', endpoint)
  assert.equal(status.available, true)
  assert.equal(status.endpoint, fixture.endpoint)
  assert.equal(status.code, 'no-model')
  assert.match(status.action ?? '', /Installez au moins un modèle/)
})

test('un moteur absent produit un diagnostic actionnable au lieu de fetch failed', async () => {
  const fixture = await withServer((_request, response) => response.end())
  await fixture.close()
  const status = await probeLocalAi('ollama', fixture.endpoint, { timeoutMs: 100 })
  assert.equal(status.available, false)
  assert.equal(status.code, 'engine-unreachable')
  assert.match(status.detail, /Aucun moteur IA n’écoute/)
  assert.match(status.action ?? '', /Démarrez Ollama/)
  assert.doesNotMatch(`${status.detail} ${status.action}`, /fetch failed/i)
})

test('un mauvais fournisseur ou endpoint distingue la route API absente', async (context) => {
  const fixture = await withServer((_request, response) => {
    response.statusCode = 404
    response.end('absent')
  })
  context.after(fixture.close)
  const status = await probeLocalAi('ollama', fixture.endpoint)
  assert.equal(status.available, false)
  assert.equal(status.code, 'endpoint-not-found')
  assert.match(status.detail, /\/api\/tags.*HTTP 404/)
  assert.match(status.action ?? '', /fournisseur sélectionné et le port/)
})

test('une réponse qui ne respecte pas le protocole Ollama est identifiée', async (context) => {
  const fixture = await withServer((_request, response) => {
    response.setHeader('content-type', 'text/html')
    response.end('<p>autre service local</p>')
  })
  context.after(fixture.close)
  const status = await probeLocalAi('ollama', fixture.endpoint)
  assert.equal(status.available, false)
  assert.equal(status.code, 'invalid-response')
  assert.match(status.detail, /catalogue.*format Ollama/)
})

test('un moteur bloqué est interrompu avec un diagnostic de délai', async (context) => {
  const fixture = await withServer(() => {
    // Conserve volontairement la réponse ouverte jusqu’à l’annulation du client.
  })
  context.after(fixture.close)
  const status = await probeLocalAi('ollama', fixture.endpoint, { timeoutMs: 25 })
  assert.equal(status.available, false)
  assert.equal(status.code, 'timeout')
  assert.match(status.detail, /délai autorisé/)
  assert.match(status.action ?? '', /modèle est chargé/)
})

test('llama.cpp est sondé puis interrogé via ses endpoints OpenAI locaux', async (context) => {
  const fixture = await withServer((request, response) => {
    response.setHeader('content-type', 'application/json')
    if (request.method === 'GET' && request.url === '/health') {
      response.end(JSON.stringify({ status: 'ok' }))
      return
    }
    if (request.method === 'GET' && request.url === '/v1/models') {
      response.end(JSON.stringify({ object: 'list', data: [{ id: 'responsive-local.gguf' }] }))
      return
    }
    if (request.method === 'POST' && request.url === '/v1/chat/completions') {
      let requestBody = ''
      request.setEncoding('utf8')
      request.on('data', (chunk) => { requestBody += chunk })
      request.on('end', () => {
        const body = JSON.parse(requestBody) as { model?: unknown; response_format?: { type?: unknown }; messages?: unknown[] }
        assert.equal(body.model, 'responsive-local.gguf')
        assert.equal(body.response_format?.type, 'json_object')
        assert.equal(body.messages?.length, 2)
        response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ answer: 'Analyse llama.cpp locale.', proposedFiles: [] }) } }] }))
      })
      return
    }
    response.statusCode = 404
    response.end('{}')
  })
  context.after(fixture.close)

  const status = await probeLocalAi('llama.cpp', fixture.endpoint)
  assert.equal(status.available, true)
  assert.equal(status.code, 'ready')
  assert.deepEqual(status.models, ['responsive-local.gguf'])
  const result = await sendLocalAiRequest({
    provider: 'llama.cpp',
    endpoint: fixture.endpoint,
    model: 'responsive-local.gguf',
    prompt: 'Analyse cette vue.',
    context: { projectName: 'Local', sourceKind: 'remote-url', route: '/', findings: [] }
  })
  assert.equal(result.text, 'Analyse llama.cpp locale.')
  assert.equal(result.provider, 'llama.cpp')
})

test('un service générique avec /health ne passe pas pour llama.cpp', async (context) => {
  const fixture = await withServer((_request, response) => {
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({ status: 'healthy' }))
  })
  context.after(fixture.close)
  const status = await probeLocalAi('llama.cpp', fixture.endpoint)
  assert.equal(status.available, false)
  assert.equal(status.code, 'invalid-response')
  assert.match(status.action ?? '', /llama-server/)
})

test('un modèle supprimé est distingué d’un endpoint absent', async (context) => {
  const fixture = await withServer((_request, response) => {
    response.statusCode = 404
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({ error: "model 'ancien:latest' not found" }))
  })
  context.after(fixture.close)
  await assert.rejects(sendLocalAiRequest({
    provider: 'ollama',
    endpoint: fixture.endpoint,
    model: 'ancien:latest',
    prompt: 'Analyse.',
    context: { projectName: 'Local', sourceKind: 'local-project', route: '/', findings: [] }
  }), /modèle demandé est introuvable.*Relancez la vérification/)
})

test('une réponse locale ne peut proposer ni secret ni chemin sortant', async (context) => {
  const fixture = await withServer((request, response) => {
    assert.equal(request.method, 'POST')
    assert.equal(request.url, '/api/chat')
    let requestBody = ''
    request.setEncoding('utf8')
    request.on('data', (chunk) => { requestBody += chunk })
    request.on('end', () => {
      const body = JSON.parse(requestBody) as { stream?: unknown; messages?: Array<{ content?: string }> }
      assert.equal(body.stream, false)
      assert.match(body.messages?.at(-1)?.content ?? '', /CONTEXTE RESPONSIVER/)
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ message: { content: JSON.stringify({
        answer: 'Correction locale proposée.',
        proposedFiles: [
          { path: 'assets/site.css', content: 'body { max-width: 100%; }', explanation: 'Évite le débordement.' },
          { path: '.env.local', content: 'SECRET=1', explanation: 'Interdit' },
          { path: '../escape.css', content: '*{}', explanation: 'Interdit' }
        ]
      }) } }))
    })
  })
  context.after(fixture.close)
  const result = await sendLocalAiRequest({
    provider: 'ollama',
    endpoint: fixture.endpoint,
    model: 'vision-local:latest',
    prompt: 'Corrige le débordement.',
    context: {
      projectName: 'Atelier',
      sourceKind: 'local-project',
      route: '/',
      findings: [],
      files: [{ path: '.env', content: 'SECRET=source' }, { path: 'assets/site.css', content: 'body{}' }]
    }
  })
  assert.equal(result.text, 'Correction locale proposée.')
  assert.deepEqual(result.proposedFiles.map((file) => file.path), ['assets/site.css'])
})
