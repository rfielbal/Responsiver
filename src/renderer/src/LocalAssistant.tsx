import { useState, type FormEvent, type ReactElement } from 'react'
import type { LocalAiResponse, LocalAiStatus, ProjectSnapshot, RemoteViewport } from '../../shared/contracts'

interface LocalAssistantProps {
  project: ProjectSnapshot
  route: string
  viewport: RemoteViewport
  screenshotDataUrl?: string | null
  workspaceEnabled: boolean
  onNotice: (message: string) => void
  onPreviewOrigin: (origin: string | null) => void
}

interface ChatMessage {
  id: string
  author: 'user' | 'assistant'
  text: string
  response?: LocalAiResponse
}

const assistantSourcePattern = /\.(?:css|scss|sass|less|html?|twig|php|jsx?|tsx?|vue|svelte|astro)$/i

async function collectLocalContextFiles(project: ProjectSnapshot): Promise<Array<{ path: string; content: string }>> {
  if (project.source.readOnly || !project.source.localRoot) return []
  const listed = await window.responsiver.listWorkspaceFiles(project.id)
  const issuePaths = new Set(project.issues.map((issue) => issue.source?.file).filter((path): path is string => Boolean(path)))
  const routeSources = new Set(project.routes.map((item) => item.sourcePath).filter((path): path is string => Boolean(path)))
  const candidates = listed
    .filter((file) => file.size <= 200_000 && assistantSourcePattern.test(file.path))
    .sort((left, right) => {
      const score = (path: string): number => (issuePaths.has(path) ? 100 : 0) + (routeSources.has(path) ? 50 : 0) + (/\.(?:css|scss|sass|less)$/i.test(path) ? 20 : 0)
      return score(right.path) - score(left.path) || left.path.localeCompare(right.path)
    })
    .slice(0, 6)
  const files: Array<{ path: string; content: string }> = []
  let bytes = 0
  for (const candidate of candidates) {
    const file = await window.responsiver.readWorkspaceFile(project.id, candidate.path).catch(() => null)
    if (!file) continue
    const nextBytes = new TextEncoder().encode(file.content).byteLength
    if (bytes + nextBytes > 600_000) break
    bytes += nextBytes
    files.push({ path: file.path, content: file.content })
  }
  return files
}

export default function LocalAssistant({ project, route, viewport, screenshotDataUrl, workspaceEnabled, onNotice, onPreviewOrigin }: LocalAssistantProps): ReactElement {
  const [provider, setProvider] = useState<'ollama' | 'llama.cpp'>('ollama')
  const [endpoint, setEndpoint] = useState('http://127.0.0.1:11434')
  const [status, setStatus] = useState<LocalAiStatus | null>(null)
  const [model, setModel] = useState('')
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])

  const changeProvider = (next: 'ollama' | 'llama.cpp'): void => {
    setProvider(next)
    setEndpoint(next === 'ollama' ? 'http://127.0.0.1:11434' : 'http://127.0.0.1:8080')
    setStatus(null)
    setModel('')
  }

  const probe = async (): Promise<void> => {
    setBusy(true)
    try {
      const next = await window.responsiver.probeLocalAi(provider, endpoint)
      setStatus(next)
      if (next.available && next.models.length && !next.models.includes(model)) setModel(next.models[0])
      onNotice(next.detail)
    } catch { onNotice('Seules les adresses loopback HTTP sont acceptées pour l’IA locale.') } finally { setBusy(false) }
  }

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    const prompt = draft.trim()
    if (!prompt || !status?.available || !model) return
    setDraft('')
    setMessages((current) => [...current, { id: `user-${Date.now()}`, author: 'user', text: prompt }])
    setBusy(true)
    try {
      const files = workspaceEnabled ? await collectLocalContextFiles(project) : []
      const response = await window.responsiver.sendLocalAi({
        provider,
        endpoint,
        model,
        prompt,
        context: {
          projectName: project.name,
          sourceKind: project.source.kind,
          route,
          viewport,
          findings: project.issues.slice(0, 30).map(({ id, title, description, rule, proposal, source }) => ({ id, title, description, rule, proposal, source })),
          files,
          screenshotDataUrl: screenshotDataUrl ?? null
        }
      })
      setMessages((current) => [...current, { id: `assistant-${Date.now()}`, author: 'assistant', text: response.text, response }])
    } catch { onNotice('Le modèle local n’a pas répondu. Aucun fallback cloud n’a été utilisé.') } finally { setBusy(false) }
  }

  const previewFile = async (path: string, content: string): Promise<void> => {
    if (!workspaceEnabled) { onNotice('Associez des sources locales avant de prévisualiser ce fichier.'); return }
    setBusy(true)
    try {
      const current = await window.responsiver.readWorkspaceFile(project.id, path)
      const next = await window.responsiver.replaceWorkspaceFile(project.id, path, content, current.version)
      onPreviewOrigin(next.previewOrigin ?? null)
      onNotice(`Proposition locale chargée dans l’overlay de ${path}, sans écriture sur disque.`)
    } catch { onNotice('La proposition ne correspond pas à un fichier source éditable et a été refusée.') } finally { setBusy(false) }
  }

  return <div className="local-assistant">
    <section className="ai-connection">
      <header><div><span className="overline">Mode local strict</span><h2>Assistant</h2></div><span className={status?.available ? 'ai-local-status is-online' : 'ai-local-status'}><i />{status?.available ? 'Connecté localement' : 'Hors ligne'}</span></header>
      <div className="ai-provider-switch"><button className={provider === 'ollama' ? 'is-active' : ''} onClick={() => changeProvider('ollama')}>Ollama</button><button className={provider === 'llama.cpp' ? 'is-active' : ''} onClick={() => changeProvider('llama.cpp')}>llama.cpp</button></div>
      <label><span>Adresse loopback</span><input value={endpoint} onChange={(event) => { setEndpoint(event.target.value); setStatus(null) }} spellCheck={false} /></label>
      <button className="button button--secondary button--full" onClick={() => void probe()} disabled={busy}>Vérifier le moteur local</button>
      {status?.available && <label><span>Modèle installé</span>{status.models.length ? <select value={model} onChange={(event) => setModel(event.target.value)}>{status.models.map((name) => <option key={name}>{name}</option>)}</select> : <input value={model} onChange={(event) => setModel(event.target.value)} placeholder="Nom du modèle chargé" />}</label>}
      <div className="ai-privacy"><strong>0 donnée envoyée au cloud</strong><span>Aucun compte · aucun fallback distant · aucune clé</span></div>
    </section>
    <div className="ai-messages">{messages.length ? messages.map((message) => <article className={`ai-message ai-message--${message.author}`} key={message.id}><span>{message.author === 'user' ? 'Vous' : `${provider} · local`}</span><p>{message.text}</p>{message.response?.proposedFiles.map((file) => <div className="ai-file-proposal" key={file.path}><code>{file.path}</code><small>{file.explanation}</small><button onClick={() => void previewFile(file.path, file.content)} disabled={busy || !workspaceEnabled}>Prévisualiser dans le code</button></div>)}</article>) : <div className="ai-empty"><strong>Une IA qui travaille sur des preuves</strong><p>Elle reçoit les constats, la route, le viewport et, si disponible, la capture. Elle ne possède ni terminal ni accès direct aux fichiers.</p></div>}</div>
    <form className="ai-prompt" onSubmit={submit}><textarea rows={4} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Ex. Analyse la hiérarchie visuelle mobile et propose une correction minimale…" disabled={!status?.available || busy} /><footer><small>{screenshotDataUrl ? 'Capture locale incluse' : 'Constats et géométrie uniquement'}</small><button className="button button--primary" disabled={!status?.available || !model || !draft.trim() || busy}>{busy ? 'Analyse locale…' : 'Envoyer localement'}</button></footer></form>
  </div>
}
