import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import type { WorkspaceFileSnapshot, WorkspaceFileSummary } from '../../shared/contracts'
import { monaco } from './monaco-setup'

interface CodeWorkspaceProps {
  projectId: string
  enabled: boolean
  preferredPath?: string | null
  onNotice: (message: string) => void
  onPreviewOrigin: (origin: string | null) => void
}

function languageFor(path: string): string {
  const extension = path.split('.').pop()?.toLowerCase()
  const languages: Record<string, string> = {
    css: 'css', scss: 'scss', less: 'less', html: 'html', htm: 'html', twig: 'html', php: 'php',
    js: 'javascript', cjs: 'javascript', mjs: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
    json: 'json', json5: 'json', md: 'markdown', yaml: 'yaml', yml: 'yaml', xml: 'xml', svg: 'xml',
    vue: 'html', svelte: 'html', astro: 'html', py: 'python', rb: 'ruby', sh: 'shell'
  }
  return languages[extension ?? ''] ?? 'plaintext'
}

function MonacoFile({ path, content, onChange }: { path: string; content: string; onChange: (content: string) => void }): ReactElement {
  const host = useRef<HTMLDivElement>(null)
  const modelRef = useRef<ReturnType<typeof monaco.editor.createModel> | null>(null)
  const syncingExternalContent = useRef(false)
  const change = useRef(onChange)
  change.current = onChange
  useEffect(() => {
    if (!host.current) return
    const model = monaco.editor.createModel(content, languageFor(path), monaco.Uri.parse(`inmemory://responsiver/${encodeURIComponent(path)}`))
    modelRef.current = model
    const editor = monaco.editor.create(host.current, {
      model,
      automaticLayout: true,
      minimap: { enabled: false },
      fontFamily: '"SFMono-Regular", "Cascadia Code", "Roboto Mono", monospace',
      fontSize: 13,
      lineHeight: 21,
      roundedSelection: false,
      padding: { top: 14, bottom: 14 },
      scrollBeyondLastLine: false,
      smoothScrolling: true,
      tabSize: 2,
      renderWhitespace: 'selection',
      wordWrap: 'off',
      theme: 'vs-dark',
      ariaLabel: `Éditeur de ${path}`
    })
    const subscription = editor.onDidChangeModelContent(() => {
      if (!syncingExternalContent.current) change.current(model.getValue())
    })
    return () => {
      subscription.dispose()
      editor.dispose()
      model.dispose()
      modelRef.current = null
    }
  }, [path])
  useEffect(() => {
    const model = modelRef.current
    if (model && model.getValue() !== content) {
      syncingExternalContent.current = true
      model.setValue(content)
      syncingExternalContent.current = false
    }
  }, [content])
  return <div className="monaco-host" ref={host} />
}

export default function CodeWorkspace({ projectId, enabled, preferredPath, onNotice, onPreviewOrigin }: CodeWorkspaceProps): ReactElement {
  const [files, setFiles] = useState<WorkspaceFileSummary[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [file, setFile] = useState<WorkspaceFileSnapshot | null>(null)
  const [filter, setFilter] = useState('')
  const [view, setView] = useState<'edit' | 'diff'>('edit')
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const selectedRef = useRef<string | null>(null)
  const versions = useRef(new Map<string, number>())
  const saveTimer = useRef<number | null>(null)
  const saveQueue = useRef<Promise<void>>(Promise.resolve())
  const pendingSaves = useRef(0)
  const latestContent = useRef('')

  selectedRef.current = selected

  const refreshFiles = async (): Promise<void> => {
    if (!enabled) return
    const next = await window.responsiver.listWorkspaceFiles(projectId)
    setFiles(next)
    setSelected((current) => current && next.some((entry) => entry.path === current)
      ? current
      : preferredPath && next.some((entry) => entry.path === preferredPath)
        ? preferredPath
        : next[0]?.path ?? null)
  }

  useEffect(() => {
    setFiles([])
    setSelected(null)
    setFile(null)
    setFilter('')
    setView('edit')
    versions.current.clear()
    if (enabled) void refreshFiles().catch(() => onNotice('L’espace code ne peut pas lire ce projet.'))
    return () => { if (saveTimer.current) window.clearTimeout(saveTimer.current) }
  }, [enabled, projectId])

  useEffect(() => {
    if (!enabled || !preferredPath || !files.some((entry) => entry.path === preferredPath)) return
    setSelected(preferredPath)
  }, [enabled, files, preferredPath])

  useEffect(() => {
    if (!selected) { setFile(null); return }
    let active = true
    setBusy(true)
    void window.responsiver.readWorkspaceFile(projectId, selected).then((next) => {
      if (!active) return
      setFile(next)
      versions.current.set(next.path, next.version)
      latestContent.current = next.content
      onPreviewOrigin(next.previewOrigin ?? null)
    }).catch(() => { if (active) onNotice('Ce fichier est protégé, binaire ou trop volumineux.') }).finally(() => { if (active) setBusy(false) })
    return () => { active = false }
  }, [projectId, selected])

  const visibleFiles = useMemo(() => {
    const query = filter.trim().toLowerCase()
    return query ? files.filter((entry) => entry.path.toLowerCase().includes(query)) : files
  }, [files, filter])

  const saveOverlay = (path: string, content: string): Promise<void> => {
    pendingSaves.current += 1
    setSaving(true)
    const operation = saveQueue.current.then(async () => {
      const next = await window.responsiver.replaceWorkspaceFile(projectId, path, content, versions.current.get(path))
      versions.current.set(path, next.version)
      if (selectedRef.current === path) setFile(next)
      onPreviewOrigin(next.previewOrigin ?? null)
      setFiles((current) => current.map((entry) => entry.path === path ? { ...entry, dirty: next.dirty, version: next.version, size: next.size } : entry))
    }).catch(() => {
      onNotice('Le fichier a changé, le projet a été remplacé ou la proposition est invalide. Rechargez-le avant de continuer.')
    }).finally(() => {
      pendingSaves.current = Math.max(0, pendingSaves.current - 1)
      if (pendingSaves.current === 0) setSaving(false)
    })
    saveQueue.current = operation
    return operation
  }

  const changeContent = (content: string): void => {
    if (!selected) return
    latestContent.current = content
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => { void saveOverlay(selected, content) }, 520)
  }

  const discard = async (): Promise<void> => {
    if (!file) return
    setBusy(true)
    try {
      if (saveTimer.current) window.clearTimeout(saveTimer.current)
      await saveQueue.current
      const next = await window.responsiver.discardWorkspaceFile(projectId, file.path, versions.current.get(file.path))
      versions.current.set(next.path, next.version)
      setFile(next)
      onPreviewOrigin(next.previewOrigin ?? null)
      setFiles((current) => current.map((entry) => entry.path === next.path ? { ...entry, dirty: false, version: next.version, size: next.size } : entry))
      onNotice('Les changements temporaires de ce fichier ont été écartés.')
    } finally { setBusy(false) }
  }

  const apply = async (): Promise<void> => {
    if (!file?.dirty) return
    setBusy(true)
    try {
      if (saveTimer.current) window.clearTimeout(saveTimer.current)
      if (latestContent.current !== file.content) await saveOverlay(file.path, latestContent.current)
      await saveQueue.current
      const result = await window.responsiver.applyWorkspaceFile(projectId, file.path, versions.current.get(file.path))
      const next = await window.responsiver.readWorkspaceFile(projectId, result.path)
      versions.current.set(next.path, next.version)
      setFile(next)
      onPreviewOrigin(next.previewOrigin ?? null)
      await refreshFiles()
      onNotice(`Modification appliquée explicitement à ${result.path}.`)
    } catch { onNotice('Le fichier source a changé : Responsiver refuse de l’écraser.') } finally { setBusy(false) }
  }

  if (!enabled) return <div className="code-empty"><span>CODE—00</span><strong>Sources non associées</strong><p>Une URL publique peut être inspectée, mais son code auteur ne peut pas être modifié. Associez un localhost à son dossier local pour activer l’éditeur.</p></div>

  return <div className="code-workspace">
    <aside className="code-files">
      <header><span>Explorateur</span><b>{files.length}</b></header>
      <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Filtrer les fichiers…" aria-label="Filtrer les fichiers" />
      <div>{visibleFiles.map((entry) => <button key={entry.path} className={selected === entry.path ? 'is-active' : ''} onClick={() => setSelected(entry.path)} title={entry.path}><i className={entry.dirty ? 'is-dirty' : ''} /><span>{entry.path}</span>{entry.dirty && <em>modifié</em>}</button>)}</div>
    </aside>
    <section className="code-editor-panel">
      <header className="code-editor-toolbar"><div><span>{file?.path ?? 'Aucun fichier'}</span>{saving && <small>Synchronisation de l’aperçu…</small>}</div><div className="code-view-switch"><button className={view === 'edit' ? 'is-active' : ''} onClick={() => setView('edit')}>Édition</button><button className={view === 'diff' ? 'is-active' : ''} onClick={() => setView('diff')} disabled={!file?.dirty}>Diff</button></div><div><button className="button button--quiet" onClick={() => void discard()} disabled={!file?.dirty || busy}>Écarter</button><button className="button button--primary" onClick={() => void apply()} disabled={!file?.dirty || busy}>Appliquer au fichier</button></div></header>
      {busy && !file ? <div className="code-loading"><span /> Lecture sécurisée…</div> : file ? view === 'edit' ? <MonacoFile key={file.path} path={file.path} content={file.content} onChange={changeContent} /> : <pre className="workspace-diff">{file.diff?.text || 'Aucune différence enregistrée.'}</pre> : <div className="code-empty"><strong>Aucun fichier texte disponible</strong><p>Les dépendances, secrets, sorties compilées et fichiers binaires sont volontairement exclus.</p></div>}
      <footer><span><i /> Overlay en mémoire</span><span>Écriture uniquement après confirmation</span><span>Secrets exclus</span></footer>
    </section>
  </div>
}
