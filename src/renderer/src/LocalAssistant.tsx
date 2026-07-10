import { useEffect, useRef, useState, type FormEvent, type ReactElement } from 'react'
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

interface AssistantContextFile {
  path: string
  content: string
}

const assistantSourcePattern = /\.(?:css|scss|sass|less|html?|twig|php|jsx?|tsx?|vue|svelte|astro)$/i

function providerLabel(provider: LocalAiResponse['provider']): string {
  return provider === 'ollama' ? 'Ollama' : 'llama.cpp'
}

function actionableError(error: unknown, fallback: string): string {
  if (!(error instanceof Error) || !error.message.trim()) return fallback
  const message = error.message
    .replace(/^Error invoking remote method '[^']+': Error:\s*/i, '')
    .replace(/^Error:\s*/i, '')
    .trim()
  return message && message.toLowerCase() !== 'fetch failed' ? message : fallback
}

async function collectLocalContextFiles(project: ProjectSnapshot): Promise<AssistantContextFile[]> {
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
  const [contextFiles, setContextFiles] = useState<AssistantContextFile[]>([])
  const [contextLoading, setContextLoading] = useState(false)
  const [includeFiles, setIncludeFiles] = useState(workspaceEnabled)
  const [includeScreenshot, setIncludeScreenshot] = useState(Boolean(screenshotDataUrl))
  const probeGeneration = useRef(0)

  const prepareContext = async (): Promise<void> => {
    if (!workspaceEnabled) {
      setContextFiles([])
      return
    }
    setContextLoading(true)
    try {
      setContextFiles(await collectLocalContextFiles(project))
    } catch {
      setContextFiles([])
      onNotice('Le contexte source n’a pas pu être préparé. Aucun fichier ne sera transmis au moteur local.')
    } finally {
      setContextLoading(false)
    }
  }

  useEffect(() => {
    setIncludeFiles(workspaceEnabled)
    setIncludeScreenshot(Boolean(screenshotDataUrl))
    void prepareContext()
  }, [project.id, workspaceEnabled])

  useEffect(() => {
    if (!screenshotDataUrl) setIncludeScreenshot(false)
  }, [screenshotDataUrl])

  const changeProvider = (next: 'ollama' | 'llama.cpp'): void => {
    probeGeneration.current += 1
    setProvider(next)
    setEndpoint(next === 'ollama' ? 'http://127.0.0.1:11434' : 'http://127.0.0.1:8080')
    setStatus(null)
    setModel('')
  }

  const probe = async (): Promise<void> => {
    const generation = probeGeneration.current + 1
    probeGeneration.current = generation
    setBusy(true)
    try {
      const next = await window.responsiver.probeLocalAi(provider, endpoint)
      if (generation !== probeGeneration.current) return
      setStatus(next)
      if (next.available && next.models.length && !next.models.includes(model)) setModel(next.models[0])
      onNotice([next.detail, next.action].filter(Boolean).join(' '))
    } catch (error) {
      if (generation !== probeGeneration.current) return
      onNotice(actionableError(error, 'Adresse invalide : utilisez une adresse HTTP loopback complète, par exemple http://127.0.0.1:11434.'))
    } finally {
      if (generation === probeGeneration.current) setBusy(false)
    }
  }

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    const prompt = draft.trim()
    if (!prompt || !status?.available || !model) return
    setDraft('')
    setMessages((current) => [...current, { id: `user-${Date.now()}`, author: 'user', text: prompt }])
    setBusy(true)
    try {
      const files = includeFiles && workspaceEnabled ? contextFiles : []
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
          screenshotDataUrl: includeScreenshot ? screenshotDataUrl ?? null : null
        }
      })
      setMessages((current) => [...current, { id: `assistant-${Date.now()}`, author: 'assistant', text: response.text, response }])
    } catch (error) {
      onNotice(actionableError(error, 'Le modèle local n’a pas répondu. Vérifiez qu’il est encore chargé ; aucun fallback cloud n’a été utilisé.'))
    } finally { setBusy(false) }
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
      <div className="ai-provider-switch"><button className={provider === 'ollama' ? 'is-active' : ''} onClick={() => changeProvider('ollama')} disabled={busy}>Ollama</button><button className={provider === 'llama.cpp' ? 'is-active' : ''} onClick={() => changeProvider('llama.cpp')} disabled={busy}>llama.cpp</button></div>
      <label><span>Adresse loopback</span><input value={endpoint} onChange={(event) => { probeGeneration.current += 1; setEndpoint(event.target.value); setStatus(null); setModel('') }} spellCheck={false} disabled={busy} /></label>
      <button className="button button--secondary button--full" onClick={() => void probe()} disabled={busy}>Vérifier le moteur local</button>
      {status?.available && <label><span>Modèle installé</span>{status.models.length ? <select value={model} onChange={(event) => setModel(event.target.value)} disabled={busy}>{status.models.map((name) => <option key={name}>{name}</option>)}</select> : <input value={model} onChange={(event) => setModel(event.target.value)} placeholder="Nom du modèle chargé" disabled={busy} />}</label>}
      {status && <div className="ai-privacy" role="status"><strong>{status.detail}</strong>{status.action && <span>{status.action}</span>}</div>}
      <div className="ai-privacy"><strong>Connexion limitée à l’adresse loopback affichée</strong><span>Aucun fallback distant. Le moteur choisi peut toutefois journaliser ou relayer les requêtes selon sa propre configuration.</span></div>
    </section>
    <section className="ai-context" aria-label="Contexte envoyé à l’assistant local">
      <header><div><span className="overline">Contexte contrôlé</span><strong>Ce qui sera transmis</strong></div><button type="button" className="text-button" onClick={() => void prepareContext()} disabled={!workspaceEnabled || contextLoading}>{contextLoading ? 'Préparation…' : 'Actualiser'}</button></header>
      <label><input type="checkbox" checked={includeFiles} onChange={(event) => setIncludeFiles(event.target.checked)} disabled={!workspaceEnabled || !contextFiles.length} /><span><strong>Sources sélectionnées</strong><small>{contextFiles.length ? `${contextFiles.length} fichier${contextFiles.length > 1 ? 's' : ''} · ${Math.round(contextFiles.reduce((total, file) => total + new TextEncoder().encode(file.content).byteLength, 0) / 1024)} Ko maximum préparés` : workspaceEnabled ? 'Aucun fichier source éligible' : 'Sources locales non associées'}</small></span></label>
      {includeFiles && contextFiles.length > 0 && <details><summary>Voir les chemins exacts</summary><ul>{contextFiles.map((file) => <li key={file.path}><code>{file.path}</code></li>)}</ul></details>}
      <label><input type="checkbox" checked={includeScreenshot} onChange={(event) => setIncludeScreenshot(event.target.checked)} disabled={!screenshotDataUrl} /><span><strong>Capture du rendu</strong><small>{screenshotDataUrl ? 'Image de la route actuellement analysée' : 'Aucune capture disponible'}</small></span></label>
      <p>La route, le viewport et jusqu’à 30 constats sont toujours inclus dans la requête. Aucun terminal ni accès autonome aux fichiers n’est accordé au modèle.</p>
    </section>
    <div className="ai-messages">{messages.length ? messages.map((message) => <article className={`ai-message ai-message--${message.author}`} key={message.id}><span>{message.author === 'user' ? 'Vous' : message.response ? `${providerLabel(message.response.provider)} · local` : 'Assistant local'}</span><p>{message.text}</p>{message.response?.proposedFiles.map((file) => <div className="ai-file-proposal" key={file.path}><code>{file.path}</code><small>{file.explanation}</small><button onClick={() => void previewFile(file.path, file.content)} disabled={busy || !workspaceEnabled}>Prévisualiser dans le code</button></div>)}</article>) : <div className="ai-empty"><strong>Une IA qui travaille sur des preuves</strong><p>Elle reçoit les constats, la route, le viewport et, si disponible, la capture. Elle ne possède ni terminal ni accès direct aux fichiers.</p></div>}</div>
    <form className="ai-prompt" onSubmit={submit}><textarea rows={4} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Ex. Analyse la hiérarchie visuelle mobile et propose une correction minimale…" disabled={!status?.available || busy} /><footer><small>{includeScreenshot && screenshotDataUrl ? 'Capture incluse' : includeFiles && contextFiles.length ? `${contextFiles.length} source${contextFiles.length > 1 ? 's' : ''} incluse${contextFiles.length > 1 ? 's' : ''}` : 'Constats et géométrie uniquement'}</small><button className="button button--primary" disabled={!status?.available || !model || !draft.trim() || busy}>{busy ? 'Analyse locale…' : 'Envoyer localement'}</button></footer></form>
  </div>
}
