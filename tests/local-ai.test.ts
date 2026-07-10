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
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({ models: [{ name: 'vision-local:latest' }, { model: 'code-local:7b' }] }))
  })
  context.after(fixture.close)
  const status = await probeLocalAi('ollama', fixture.endpoint)
  assert.equal(status.available, true)
  assert.deepEqual(status.models, ['vision-local:latest', 'code-local:7b'])
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
