import { useEffect, useRef, useState, type ReactElement } from 'react'

interface OnboardingTourProps {
  initialHideOnStartup: boolean
  onClose: (hideOnStartup: boolean) => void
}

interface TourStep {
  id: 'welcome' | 'sources' | 'laboratory' | 'workspaces' | 'review' | 'ready'
  chapter: string
  eyebrow: string
  title: string
  summary: string
  points: Array<{ title: string; detail: string }>
}

const steps: TourStep[] = [
  {
    id: 'welcome',
    chapter: 'Le parcours',
    eyebrow: 'Bienvenue dans Responsiver',
    title: 'Un site responsive, sans perdre votre journée.',
    summary: 'Responsiver réunit le rendu réel, le diagnostic et les corrections dans un atelier local. Vous gardez la main avant chaque écriture.',
    points: [
      { title: 'Observer', detail: 'Testez les pages sur les largeurs qui comptent.' },
      { title: 'Corriger', detail: 'Traitez un problème seul ou préparez un lot.' },
      { title: 'Valider', detail: 'Comparez, testez, puis appliquez explicitement.' }
    ]
  },
  {
    id: 'sources',
    chapter: 'Ouvrir un site',
    eyebrow: 'Choisir la bonne entrée',
    title: 'Trois façons de commencer, un niveau d’action clair.',
    summary: 'Responsiver adapte ses outils à la source ouverte. Le niveau d’accès est toujours annoncé avant de travailler.',
    points: [
      { title: 'Projet local', detail: 'Analyse, prévisualisation et corrections durables.' },
      { title: 'Localhost associé', detail: 'Rendu du serveur actif et sources locales liées.' },
      { title: 'URL publique', detail: 'Audit visuel complet, volontairement en lecture seule.' }
    ]
  },
  {
    id: 'laboratory',
    chapter: 'Diagnostiquer',
    eyebrow: 'Le Laboratoire',
    title: 'Repérez ce qui casse vraiment, écran par écran.',
    summary: 'Naviguez dans le vrai site, changez d’appareil ou redimensionnez librement la preview. Les constats visuels restent séparés des remarques de code.',
    points: [
      { title: 'Plusieurs pages', detail: 'Testez la navigation et les états réels du projet.' },
      { title: 'Ciblage direct', detail: 'Un constat vous ramène à l’élément concerné.' },
      { title: 'Avant / après', detail: 'Voyez le résultat avant de préparer le correctif.' }
    ]
  },
  {
    id: 'workspaces',
    chapter: 'Ajuster',
    eyebrow: 'Atelier visuel & Code',
    title: 'Corrigez aussi vite que le problème le demande.',
    summary: 'Une navbar mobile peut se régler visuellement. Une règle précise peut s’éditer dans le code. Dans les deux cas, le rendu reste visible.',
    points: [
      { title: 'Composer', detail: 'Glissez librement ; Maj + glisser réordonne les blocs.' },
      { title: 'Inspecter', detail: 'Reliez le rendu à sa structure avec F12, jusque dans l’Atelier.' },
      { title: 'Contrôler', detail: 'Plein écran, Tester et Avant / après gardent le rendu lisible.' }
    ]
  },
  {
    id: 'review',
    chapter: 'Contrôler',
    eyebrow: 'Correction Express & révision',
    title: 'Vérifiez les vues utiles avant de toucher au projet.',
    summary: 'Une correction traçable passe par la matrice Mobile, Tablette et Bureau. Les cas plus libres restent dans la révision détaillée.',
    points: [
      { title: 'Corriger et vérifier', detail: 'Comparez source et candidat sans écrire les fichiers.' },
      { title: 'Matrice lisible', detail: 'Repérez les vues améliorées, stables ou en régression.' },
      { title: 'Retour possible', detail: 'La dernière application reste annulable.' }
    ]
  },
  {
    id: 'ready',
    chapter: 'À vous de jouer',
    eyebrow: 'Votre méthode, votre rythme',
    title: 'Commencez petit. Responsiver suit le besoin.',
    summary: 'Pour une correction simple, le parcours tient en quelques clics. Les outils avancés restent disponibles sans ralentir le travail courant.',
    points: [
      { title: '1', detail: 'Ouvrez le projet ou son localhost.' },
      { title: '2', detail: 'Choisissez un constat visuel utile.' },
      { title: '3', detail: 'Comparez, testez et appliquez.' }
    ]
  }
]

function TourGlyph({ name, size = 18 }: { name: string; size?: number }): ReactElement {
  const props = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.65, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true }
  const paths: Record<string, ReactElement> = {
    close: <><path d="m6 6 12 12M18 6 6 18" /></>,
    back: <><path d="m15 18-6-6 6-6" /><path d="M9 12h11" /></>,
    next: <><path d="M4 12h16" /><path d="m14 6 6 6-6 6" /></>,
    shield: <><path d="M12 3 5 6v5c0 4.4 2.9 8.4 7 10 4.1-1.6 7-5.6 7-10V6l-7-3Z" /><path d="m9 12 2 2 4-5" /></>,
    folder: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />,
    globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18" /></>,
    server: <><rect x="4" y="4" width="16" height="6" rx="1" /><rect x="4" y="14" width="16" height="6" rx="1" /><path d="M8 7h.01M8 17h.01" /></>,
    code: <><path d="m8 9-4 3 4 3M16 9l4 3-4 3" /><path d="m14 5-4 14" /></>,
    cursor: <><path d="m5 3 14 8-6 2-3 6Z" /><path d="m13 13 5 5" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    device: <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 7h8M8 11h5M8 15h8" /></>
  }
  return <svg {...props}>{paths[name] ?? paths.check}</svg>
}

function BrandMark(): ReactElement {
  return <span className="onboarding-brand-mark" aria-hidden="true"><i /><i /><i /></span>
}

function WorkflowScene(): ReactElement {
  return <div className="tour-scene tour-scene--workflow" aria-hidden="true">
    <div className="tour-window-bar"><i /><i /><i /><span>RESPONSIVER / WORKBENCH</span></div>
    <div className="tour-workflow">
      <div className="tour-workflow-card"><span>01</span><TourGlyph name="folder" /><b>Projet</b><small>Ouvrir</small></div>
      <i className="tour-flow-line" />
      <div className="tour-workflow-card is-accent"><span>02</span><TourGlyph name="device" /><b>Rendu</b><small>Observer</small></div>
      <i className="tour-flow-line" />
      <div className="tour-workflow-card"><span>03</span><TourGlyph name="check" /><b>Correctif</b><small>Valider</small></div>
    </div>
    <div className="tour-local-note"><TourGlyph name="shield" size={16} /><span><b>Local par défaut</b> · aucune écriture silencieuse</span></div>
  </div>
}

function SourcesScene(): ReactElement {
  return <div className="tour-scene tour-scene--sources" aria-hidden="true">
    <div className="tour-scene-label">CHOISIR UNE SOURCE</div>
    <div className="tour-source-stack">
      <div className="tour-source-card is-primary"><span><TourGlyph name="folder" /></span><div><b>Projet local</b><small>Dossier ou fichier</small></div><em>COMPLET</em></div>
      <div className="tour-source-card"><span><TourGlyph name="server" /></span><div><b>Localhost</b><small>Serveur + sources</small></div><em>LIÉ</em></div>
      <div className="tour-source-card"><span><TourGlyph name="globe" /></span><div><b>URL publique</b><small>Diagnostic distant</small></div><em>LECTURE</em></div>
    </div>
    <p>Le niveau d’accès reste visible dans toute l’application.</p>
  </div>
}

function LaboratoryScene(): ReactElement {
  return <div className="tour-scene tour-scene--laboratory" aria-hidden="true">
    <div className="tour-lab-toolbar"><span className="is-active">Mobile</span><span>Tablette</span><span>Bureau</span><code>393 × 852</code></div>
    <div className="tour-lab-stage">
      <div className="tour-device"><header><i /><i /></header><main><span /><span /><span /></main><span className="tour-demo-action">Action</span></div>
      <div className="tour-finding-pin">01</div>
      <div className="tour-finding-card"><span>VISUEL · MOBILE</span><b>Navigation trop dense</b><small>Ciblée dans le rendu</small><i>Avant / après →</i></div>
    </div>
  </div>
}

function WorkspacesScene(): ReactElement {
  return <div className="tour-scene tour-scene--workspaces" aria-hidden="true">
    <div className="tour-workspace-tabs"><span className="is-active"><TourGlyph name="cursor" size={14} /> Atelier</span><span><TourGlyph name="code" size={14} /> Code</span><em>PREVIEW ACTIVE</em></div>
    <div className="tour-editor-grid">
      <div className="tour-editor-canvas"><div className="tour-selected-block"><i /><i /><i /><i /><span>Navigation</span></div><div className="tour-copy-lines"><i /><i /><i /></div></div>
      <div className="tour-code-lines"><code><b>01</b> .navigation {'{'}</code><code><b>02</b> &nbsp;display: flex;</code><code className="is-change"><b>03</b> &nbsp;gap: 1rem;</code><code><b>04</b> {'}'}</code></div>
    </div>
    <div className="tour-inspector-chip">F12 <span>Inspecter le rendu</span></div>
  </div>
}

function ReviewScene(): ReactElement {
  return <div className="tour-scene tour-scene--review" aria-hidden="true">
    <div className="tour-review-head"><span>PLAN DE CHANGEMENTS</span><b>2 sélectionnés</b></div>
    <div className="tour-change-row"><i><TourGlyph name="check" size={13} /></i><div><b>Navigation mobile</b><small>responsiver.generated.css</small></div><em>VISUEL</em></div>
    <div className="tour-change-row"><i><TourGlyph name="check" size={13} /></i><div><b>Retour à la ligne sûr</b><small>styles/components.css</small></div><em>CODE</em></div>
    <div className="tour-diff"><code><span>−</span> white-space: nowrap;</code><code><b>+</b> white-space: normal;</code></div>
    <div className="tour-apply-bar"><span><TourGlyph name="shield" size={15} /> Aucune source modifiée</span><span className="tour-demo-apply">Corriger et vérifier</span></div>
  </div>
}

function ReadyScene(): ReactElement {
  return <div className="tour-scene tour-scene--ready" aria-hidden="true">
    <div className="tour-ready-orbit"><div><BrandMark /></div><span className="orbit orbit--one" /><span className="orbit orbit--two" /><i className="orbit-dot orbit-dot--one" /><i className="orbit-dot orbit-dot--two" /><i className="orbit-dot orbit-dot--three" /></div>
    <div className="tour-ready-steps"><span><b>01</b> Ouvrir</span><i /><span><b>02</b> Corriger</span><i /><span><b>03</b> Valider</span></div>
    <p>Le guide reste disponible à tout moment depuis <b>?</b> dans le menu.</p>
  </div>
}

function StepScene({ step }: { step: TourStep['id'] }): ReactElement {
  if (step === 'welcome') return <WorkflowScene />
  if (step === 'sources') return <SourcesScene />
  if (step === 'laboratory') return <LaboratoryScene />
  if (step === 'workspaces') return <WorkspacesScene />
  if (step === 'review') return <ReviewScene />
  return <ReadyScene />
}

export default function OnboardingTour({ initialHideOnStartup, onClose }: OnboardingTourProps): ReactElement {
  const [stepIndex, setStepIndex] = useState(0)
  const [hideOnStartup, setHideOnStartup] = useState(initialHideOnStartup)
  const dialogRef = useRef<HTMLElement>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const activeStep = steps[stepIndex]
  const isLastStep = stepIndex === steps.length - 1

  const goToStep = (nextIndex: number): void => {
    setStepIndex(Math.max(0, Math.min(steps.length - 1, nextIndex)))
  }

  useEffect(() => {
    const suppressed = [...document.querySelectorAll<HTMLElement>('.nav-rail, .app-main')].map((element) => ({
      element,
      inert: element.inert,
      ariaHidden: element.getAttribute('aria-hidden')
    }))
    for (const { element } of suppressed) {
      element.inert = true
      element.setAttribute('aria-hidden', 'true')
    }
    document.body.classList.add('is-onboarding-open')
    const focusFrame = window.requestAnimationFrame(() => titleRef.current?.focus())
    return () => {
      window.cancelAnimationFrame(focusFrame)
      document.body.classList.remove('is-onboarding-open')
      for (const { element, inert, ariaHidden } of suppressed) {
        element.inert = inert
        if (ariaHidden === null) element.removeAttribute('aria-hidden')
        else element.setAttribute('aria-hidden', ariaHidden)
      }
    }
  }, [])

  useEffect(() => {
    if (stepIndex === 0) return
    window.requestAnimationFrame(() => titleRef.current?.focus())
  }, [stepIndex])

  useEffect(() => {
    const handleKeyboard = (event: KeyboardEvent): void => {
      const target = event.target
      const editableTarget = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || (target instanceof HTMLElement && target.isContentEditable)
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose(hideOnStartup)
        return
      }
      if (event.key === 'ArrowRight' && !editableTarget) {
        event.preventDefault()
        goToStep(stepIndex + 1)
        return
      }
      if (event.key === 'ArrowLeft' && !editableTarget) {
        event.preventDefault()
        goToStep(stepIndex - 1)
        return
      }
      if (event.key !== 'Tab') return
      const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])') ?? [])].filter((element) => !element.hidden && element.getClientRects().length > 0)
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', handleKeyboard, true)
    return () => window.removeEventListener('keydown', handleKeyboard, true)
  }, [hideOnStartup, onClose, stepIndex])

  return <div className="onboarding-overlay">
    <section id="responsiver-onboarding" ref={dialogRef} className="onboarding-dialog" role="dialog" aria-modal="true" aria-labelledby="onboarding-dialog-label" aria-describedby="onboarding-summary">
      <h2 id="onboarding-dialog-label" className="sr-only">Prise en main de Responsiver</h2>
      <aside className="onboarding-rail">
        <div className="onboarding-brand"><BrandMark /><span><b>Responsiver</b><small>Guide de prise en main</small></span></div>
        <div className="onboarding-rail-heading"><span>VISITE GUIDÉE</span><b>{String(stepIndex + 1).padStart(2, '0')} / {String(steps.length).padStart(2, '0')}</b></div>
        <nav aria-label="Étapes du guide">
          <ol>{steps.map((step, index) => <li key={step.id}><button type="button" className={index === stepIndex ? 'is-active' : index < stepIndex ? 'is-complete' : ''} onClick={() => goToStep(index)} aria-current={index === stepIndex ? 'step' : undefined} aria-label={`Étape ${index + 1} sur ${steps.length} : ${step.chapter}`}><span>{index < stepIndex ? <TourGlyph name="check" size={12} /> : String(index + 1).padStart(2, '0')}</span><b>{step.chapter}</b></button></li>)}</ol>
        </nav>
        <div className="onboarding-privacy"><TourGlyph name="shield" size={16} /><span><b>Guide 100 % local</b><small>Aucun compte ni donnée envoyée.</small></span></div>
      </aside>

      <div className="onboarding-main">
        <header className="onboarding-topbar"><span role="status" aria-live="polite" aria-atomic="true">PRISE EN MAIN · ÉTAPE {String(stepIndex + 1).padStart(2, '0')} / {String(steps.length).padStart(2, '0')}</span><button type="button" onClick={() => onClose(hideOnStartup)} aria-label="Fermer le guide" title="Fermer le guide"><TourGlyph name="close" size={17} /></button></header>
        <div className="onboarding-content">
          <article className="onboarding-copy">
            <span className="onboarding-eyebrow">{activeStep.eyebrow}</span>
            <h1 id="onboarding-title" ref={titleRef} tabIndex={-1}>{activeStep.title}</h1>
            <p id="onboarding-summary">{activeStep.summary}</p>
            <ul>{activeStep.points.map((point, index) => <li key={point.title}><span>{activeStep.id === 'ready' ? point.title : String(index + 1).padStart(2, '0')}</span><div><b>{activeStep.id === 'ready' ? point.detail : point.title}</b>{activeStep.id !== 'ready' && <small>{point.detail}</small>}</div></li>)}</ul>
          </article>
          <StepScene step={activeStep.id} />
        </div>

        <footer className="onboarding-footer">
          <label className="onboarding-preference"><input type="checkbox" checked={hideOnStartup} onChange={(event) => setHideOnStartup(event.target.checked)} /><span aria-hidden="true"><TourGlyph name="check" size={12} /></span><div><b>Ne plus afficher au démarrage</b><small>Le guide restera accessible depuis le bouton ? du menu.</small></div></label>
          <div className="onboarding-actions">
            {stepIndex === 0 ? <button type="button" className="onboarding-skip" onClick={() => onClose(hideOnStartup)}>Passer pour le moment</button> : <button type="button" className="button button--secondary" onClick={() => goToStep(stepIndex - 1)}><TourGlyph name="back" size={15} /> Précédent</button>}
            <button type="button" className="button button--primary onboarding-next" onClick={() => isLastStep ? onClose(hideOnStartup) : goToStep(stepIndex + 1)}>{isLastStep ? 'Terminer le guide' : 'Continuer'} <TourGlyph name={isLastStep ? 'check' : 'next'} size={15} /></button>
          </div>
        </footer>
      </div>
    </section>
  </div>
}
