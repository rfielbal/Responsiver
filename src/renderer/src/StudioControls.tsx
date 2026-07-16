import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import {
  DEFAULT_DEVICE_SUITE_ID,
  MAX_ACTIVE_DEVICES,
  MAX_CUSTOM_DEVICES,
  MAX_CUSTOM_SUITES,
  allDeviceProfiles,
  createCustomDeviceProfile,
  createDeviceSuite,
  findDeviceProfile,
  type DeviceCatalogState,
  type DeviceCategory,
  type DeviceProfile
} from '../../shared/device-catalog'
import { Icon, type IconName } from './Icon'

export type StudioLayout = 'aligned' | 'grid' | 'focus'

export interface StudioSyncState {
  navigation: boolean
  scroll: boolean
  interactions: boolean
}

export interface StudioOverlayState {
  enabled: boolean
  src: string | null
  fileName: string | null
  opacity: number
}

export interface StudioControlsProps {
  catalogState: DeviceCatalogState
  onCatalogState: (state: DeviceCatalogState) => void
  activeDeviceIds: readonly string[]
  onActiveDeviceIds: (deviceIds: readonly string[], catalogOverride?: DeviceCatalogState) => void
  layout: StudioLayout
  onLayout: (layout: StudioLayout) => void
  sync: StudioSyncState
  onSync: (sync: StudioSyncState) => void
  overlay: StudioOverlayState
  onOverlay: (overlay: StudioOverlayState) => void
  onCapture: () => void
  captureBusy?: boolean
  syncCapabilities?: Partial<Record<keyof StudioSyncState, boolean>>
  overlayDisabledReason?: string | null
  captureDisabledReason?: string | null
  disabledReason?: string | null
  onInterfaceOverlayChange?: (open: boolean) => void
}

const FAVORITES_STORAGE_KEY = 'responsiver.device-favorites.v1'

const CATEGORY_LABELS: Record<DeviceCategory, string> = {
  phone: 'Téléphones',
  tablet: 'Tablettes',
  foldable: 'Pliables',
  laptop: 'Portables',
  desktop: 'Bureaux'
}

const CATEGORY_ICONS: Record<DeviceCategory, IconName> = {
  phone: 'phone',
  tablet: 'tablet',
  foldable: 'layers',
  laptop: 'laptop',
  desktop: 'monitor'
}

const LAYOUTS: readonly { id: StudioLayout; label: string; hint: string; icon: IconName }[] = [
  { id: 'aligned', label: 'Alignés', hint: 'Une ligne horizontale continue', icon: 'layout' },
  { id: 'grid', label: 'Grille', hint: 'Une planche qui exploite la largeur', icon: 'grid' },
  { id: 'focus', label: 'Focus', hint: 'Un écran principal, les autres en repères', icon: 'focus' }
]

function readFavorites(): string[] {
  if (typeof window === 'undefined') return []
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(FAVORITES_STORAGE_KEY) ?? '[]')
    return Array.isArray(parsed)
      ? [...new Set(parsed.filter((value): value is string => typeof value === 'string'))].slice(0, 100)
      : []
  } catch {
    return []
  }
}

function normalizedSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('fr-FR')
    .trim()
}

function matchesSearch(profile: DeviceProfile, search: string): boolean {
  if (!search) return true
  const haystack = normalizedSearch([
    profile.name,
    profile.brand,
    profile.family,
    profile.category,
    ...profile.tags
  ].join(' '))
  return haystack.includes(search)
}

function compactDimensions(profile: DeviceProfile): string {
  return `${profile.width} × ${profile.height} · DPR ${profile.dpr}`
}

export function StudioControls({
  catalogState,
  onCatalogState,
  activeDeviceIds,
  onActiveDeviceIds,
  layout,
  onLayout,
  sync,
  onSync,
  overlay,
  onOverlay,
  onCapture,
  captureBusy = false,
  syncCapabilities,
  overlayDisabledReason,
  captureDisabledReason,
  disabledReason,
  onInterfaceOverlayChange
}: StudioControlsProps) {
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [category, setCategory] = useState<DeviceCategory | 'all'>('all')
  const [search, setSearch] = useState('')
  const [favorites, setFavorites] = useState<string[]>(readFavorites)
  const [showCustomForm, setShowCustomForm] = useState(false)
  const [customError, setCustomError] = useState<string | null>(null)
  const [customName, setCustomName] = useState('')
  const [customCategory, setCustomCategory] = useState<DeviceCategory>('phone')
  const [customWidth, setCustomWidth] = useState('390')
  const [customHeight, setCustomHeight] = useState('844')
  const [customDpr, setCustomDpr] = useState('2')
  const [savingSuite, setSavingSuite] = useState(false)
  const [suiteName, setSuiteName] = useState('')
  const [suiteError, setSuiteError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [openPopover, setOpenPopover] = useState<'sync' | 'overlay' | null>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const libraryDialogRef = useRef<HTMLElement>(null)
  const libraryTriggerRef = useRef<HTMLButtonElement>(null)
  const focusBeforeLibraryRef = useRef<HTMLElement | null>(null)
  const disabled = Boolean(disabledReason)
  const availableSync = {
    navigation: syncCapabilities?.navigation !== false,
    scroll: syncCapabilities?.scroll !== false,
    interactions: syncCapabilities?.interactions !== false
  }
  const activeSyncCount = Number(sync.navigation && availableSync.navigation) + Number(sync.scroll && availableSync.scroll) + Number(sync.interactions && availableSync.interactions)
  const availableSyncCount = Number(availableSync.navigation) + Number(availableSync.scroll) + Number(availableSync.interactions)

  const profiles = useMemo(() => allDeviceProfiles(catalogState), [catalogState])
  const profileIds = useMemo(() => new Set(profiles.map((profile) => profile.id)), [profiles])
  const activeIds = useMemo(() => (
    [...new Set(activeDeviceIds.filter((id) => profileIds.has(id)))].slice(0, MAX_ACTIVE_DEVICES)
  ), [activeDeviceIds, profileIds])
  const favoriteSet = useMemo(() => new Set(favorites), [favorites])
  const searchTerm = normalizedSearch(search)
  const filteredProfiles = useMemo(() => profiles
    .filter((profile) => category === 'all' || profile.category === category)
    .filter((profile) => matchesSearch(profile, searchTerm))
    .sort((left, right) => {
      const favoriteDelta = Number(favoriteSet.has(right.id)) - Number(favoriteSet.has(left.id))
      if (favoriteDelta) return favoriteDelta
      const categoryDelta = Object.keys(CATEGORY_LABELS).indexOf(left.category) - Object.keys(CATEGORY_LABELS).indexOf(right.category)
      if (categoryDelta) return categoryDelta
      return `${left.brand} ${left.name}`.localeCompare(`${right.brand} ${right.name}`, 'fr-FR')
    }), [category, favoriteSet, profiles, searchTerm])
  const builtInSuites = catalogState.suites.filter((suite) => suite.builtIn)
  const personalSuites = catalogState.suites.filter((suite) => !suite.builtIn)
  const activeSuite = catalogState.suites.find((suite) => suite.id === catalogState.activeSuiteId) ?? null
  const activeSuiteMatches = Boolean(activeSuite
    && activeSuite.deviceIds.length === activeIds.length
    && activeSuite.deviceIds.every((id, index) => id === activeIds[index]))
  const selectedSuiteValue = activeSuiteMatches ? catalogState.activeSuiteId : '__manual-selection'

  useEffect(() => {
    if (!libraryOpen) return
    focusBeforeLibraryRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : libraryTriggerRef.current
    const timeout = window.setTimeout(() => searchInputRef.current?.focus(), 30)
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setLibraryOpen(false)
        return
      }
      if (event.key !== 'Tab') return
      const dialog = libraryDialogRef.current
      if (!dialog) return
      const focusable = [...dialog.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled):not([tabindex="-1"]), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])'
      )].filter((element) => !element.hidden && element.getAttribute('aria-hidden') !== 'true')
      const first = focusable[0]
      const last = focusable.at(-1)
      if (!first || !last) return
      if (!dialog.contains(document.activeElement)) {
        event.preventDefault()
        const target = event.shiftKey ? last : first
        target.focus()
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.clearTimeout(timeout)
      window.removeEventListener('keydown', onKeyDown)
      const target = focusBeforeLibraryRef.current
      focusBeforeLibraryRef.current = null
      window.requestAnimationFrame(() => {
        if (target?.isConnected) target.focus({ preventScroll: true })
      })
    }
  }, [libraryOpen])

  useEffect(() => {
    onInterfaceOverlayChange?.(libraryOpen || openPopover !== null)
  }, [libraryOpen, onInterfaceOverlayChange, openPopover])

  useEffect(() => () => onInterfaceOverlayChange?.(false), [onInterfaceOverlayChange])

  useEffect(() => {
    if (!notice || savingSuite) return
    const timer = window.setTimeout(() => setNotice(null), 5_000)
    return () => window.clearTimeout(timer)
  }, [notice, savingSuite])

  useEffect(() => {
    if (!openPopover) return
    const closeOutside = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Element) || !target.closest('.studio-controls__popover')) setOpenPopover(null)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      setOpenPopover(null)
    }
    document.addEventListener('pointerdown', closeOutside, true)
    document.addEventListener('keydown', closeOnEscape, true)
    return () => {
      document.removeEventListener('pointerdown', closeOutside, true)
      document.removeEventListener('keydown', closeOnEscape, true)
    }
  }, [openPopover])

  useEffect(() => {
    if (disabled) setOpenPopover(null)
  }, [disabled])

  const updateFavorites = (next: string[]) => {
    setFavorites(next)
    try {
      window.localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(next))
    } catch {
      // Les favoris restent utilisables pour la session si le stockage est indisponible.
    }
  }

  const toggleFavorite = (profileId: string) => {
    updateFavorites(favoriteSet.has(profileId)
      ? favorites.filter((id) => id !== profileId)
      : [...favorites, profileId].slice(0, 100))
  }

  const selectSuite = (suiteId: string) => {
    const suite = catalogState.suites.find((candidate) => candidate.id === suiteId)
    if (!suite) return
    onCatalogState({ ...catalogState, activeSuiteId: suite.id })
    onActiveDeviceIds(suite.deviceIds.slice(0, MAX_ACTIVE_DEVICES))
    setNotice(`Suite « ${suite.name} » chargée.`)
  }

  const addDevice = (profileId: string) => {
    if (activeIds.includes(profileId)) return
    if (activeIds.length >= MAX_ACTIVE_DEVICES) {
      setNotice('La planche contient déjà cinq écrans. Retirez-en un pour en ajouter un autre.')
      return
    }
    onActiveDeviceIds([...activeIds, profileId])
    setNotice(null)
  }

  const removeDevice = (profileId: string) => {
    if (activeIds.length <= 1) {
      setNotice('Gardez au moins un écran dans le Studio.')
      return
    }
    onActiveDeviceIds(activeIds.filter((id) => id !== profileId))
    setNotice(null)
  }

  const submitCustomDevice = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setCustomError(null)
    try {
      if (catalogState.customDevices.length >= MAX_CUSTOM_DEVICES) throw new TypeError(`La bibliothèque personnelle est limitée à ${MAX_CUSTOM_DEVICES} formats.`)
      const profile = createCustomDeviceProfile({
        name: customName,
        category: customCategory,
        width: Number(customWidth),
        height: Number(customHeight),
        dpr: Number(customDpr)
      })
      if (profiles.some((candidate) => candidate.id === profile.id)) {
        throw new TypeError('Ce format personnalisé existe déjà dans votre bibliothèque.')
      }
      const nextState = { ...catalogState, customDevices: [...catalogState.customDevices, profile] }
      onCatalogState(nextState)
      if (activeIds.length < MAX_ACTIVE_DEVICES) onActiveDeviceIds([...activeIds, profile.id], nextState)
      setCustomName('')
      setShowCustomForm(false)
      setNotice(activeIds.length < MAX_ACTIVE_DEVICES
        ? `« ${profile.name} » a été créé et ajouté à la planche.`
        : `« ${profile.name} » a été créé. Il reste disponible dans la bibliothèque.`)
    } catch (error) {
      setCustomError(error instanceof Error ? error.message : 'Ce format personnalisé est invalide.')
    }
  }

  const saveCurrentSuite = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSuiteError(null)
    try {
      if (personalSuites.length >= MAX_CUSTOM_SUITES) throw new TypeError(`Vous pouvez conserver jusqu’à ${MAX_CUSTOM_SUITES} suites personnelles.`)
      const suite = createDeviceSuite({ name: suiteName, deviceIds: activeIds }, profileIds)
      if (catalogState.suites.some((candidate) => candidate.id === suite.id)) {
        throw new TypeError('Une suite identique existe déjà.')
      }
      onCatalogState({
        ...catalogState,
        suites: [...catalogState.suites, suite],
        activeSuiteId: suite.id
      })
      setSuiteName('')
      setSavingSuite(false)
      setNotice(`Suite « ${suite.name} » enregistrée.`)
    } catch (error) {
      setSuiteError(error instanceof Error ? error.message : 'Cette suite ne peut pas être enregistrée.')
    }
  }

  const deleteActivePersonalSuite = () => {
    if (!activeSuiteMatches || !activeSuite || activeSuite.builtIn) return
    const fallback = catalogState.suites.find((suite) => suite.id === DEFAULT_DEVICE_SUITE_ID)
      ?? catalogState.suites.find((suite) => suite.builtIn)
    if (!fallback) return
    onCatalogState({
      ...catalogState,
      suites: catalogState.suites.filter((suite) => suite.id !== activeSuite.id),
      activeSuiteId: fallback.id
    })
    onActiveDeviceIds(fallback.deviceIds.slice(0, MAX_ACTIVE_DEVICES))
    setNotice(`Suite « ${activeSuite.name} » supprimée.`)
  }

  const chooseOverlay = () => imageInputRef.current?.click()

  const loadOverlay = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setNotice('Choisissez une image PNG, JPEG, WebP ou SVG pour la maquette.')
      return
    }
    const src = URL.createObjectURL(file)
    onOverlay({ enabled: true, src, fileName: file.name, opacity: overlay.opacity || 0.5 })
    setNotice(`Maquette « ${file.name} » superposée aux écrans.`)
  }

  const clearOverlay = () => {
    onOverlay({ enabled: false, src: null, fileName: null, opacity: overlay.opacity })
    setNotice('Maquette retirée de la planche.')
  }

  return <section className="studio-controls" aria-label="Commandes du Studio multi-écrans">
    {disabledReason && <div className="studio-controls__disabled" role="status">
      <Icon name="info" />
      <span>{disabledReason}</span>
    </div>}

    <div className="studio-controls__bar" aria-disabled={disabled || undefined}>
      <div className="studio-controls__suite">
        <label htmlFor="studio-suite">Suite</label>
        <select
          id="studio-suite"
          value={selectedSuiteValue}
          onChange={(event) => selectSuite(event.currentTarget.value)}
          disabled={disabled}
        >
          {!activeSuiteMatches && <option value="__manual-selection" disabled>Sélection manuelle</option>}
          <optgroup label="Suites Responsiver">
            {builtInSuites.map((suite) => <option key={suite.id} value={suite.id}>{suite.name}</option>)}
          </optgroup>
          {personalSuites.length > 0 && <optgroup label="Mes suites">
            {personalSuites.map((suite) => <option key={suite.id} value={suite.id}>{suite.name}</option>)}
          </optgroup>}
        </select>
        <span className="studio-controls__counter" aria-label={`${activeIds.length} écrans actifs sur ${MAX_ACTIVE_DEVICES}`}>
          {activeIds.length}/{MAX_ACTIVE_DEVICES}
        </span>
        <button
          ref={libraryTriggerRef}
          type="button"
          className="studio-icon-button"
          onClick={() => { setOpenPopover(null); setLibraryOpen(true) }}
          disabled={disabled}
          title="Ouvrir la bibliothèque d’appareils"
          aria-label="Ouvrir la bibliothèque d’appareils"
        ><Icon name="deviceAdd" /></button>
        <button
          type="button"
          className="studio-icon-button"
          onClick={() => { setSavingSuite(true); setNotice(null) }}
          disabled={disabled}
          title="Enregistrer cette sélection comme suite"
          aria-label="Enregistrer cette sélection comme suite"
        ><Icon name="star" /></button>
      </div>

      <div className="studio-controls__layouts" role="group" aria-label="Disposition des écrans">
        {LAYOUTS.map((item) => <button
          type="button"
          key={item.id}
          className={layout === item.id ? 'is-active' : undefined}
          aria-pressed={layout === item.id}
          onClick={() => onLayout(item.id)}
          disabled={disabled}
          title={item.hint}
          aria-label={item.label}
        >
          <Icon name={item.icon} />
          <span>{item.label}</span>
        </button>)}
      </div>

      <details className="studio-controls__popover" open={openPopover === 'sync'}>
        <summary
          aria-label={`Régler les synchronisations — ${activeSyncCount} sur ${availableSyncCount} actives`}
          aria-disabled={disabled || undefined}
          aria-expanded={openPopover === 'sync'}
          aria-controls="studio-sync-popover"
          onClick={(event) => {
            event.preventDefault()
            if (!disabled) setOpenPopover((current) => current === 'sync' ? null : 'sync')
          }}
        >
          <Icon name={activeSyncCount > 0 ? 'link' : 'unlink'} />
          <span>Synchroniser</span>
          <span className="studio-controls__signal" aria-hidden="true">
            {activeSyncCount}/{availableSyncCount}
          </span>
        </summary>
        <div id="studio-sync-popover" className="studio-controls__popover-panel studio-controls__sync-panel">
          <p className="studio-controls__popover-title">Comportements liés</p>
          <label className="studio-switch-row">
            <span><Icon name="navigation" /><span><strong>Navigation</strong><small>La même route sur tous les écrans liés.</small></span></span>
            <input type="checkbox" checked={sync.navigation && availableSync.navigation} onChange={(event) => onSync({ ...sync, navigation: event.currentTarget.checked })} disabled={disabled || !availableSync.navigation} />
          </label>
          <label className="studio-switch-row">
            <span><Icon name="scroll" /><span><strong>Défilement</strong><small>Le pilote aligne les autres écrans.</small></span></span>
            <input type="checkbox" checked={sync.scroll && availableSync.scroll} onChange={(event) => onSync({ ...sync, scroll: event.currentTarget.checked })} disabled={disabled || !availableSync.scroll} />
          </label>
          <label className="studio-switch-row">
            <span><Icon name="touch" /><span><strong>Interactions sûres</strong><small>Bascules et contrôles explicitement sûrs, jamais les envois.</small></span></span>
            <input type="checkbox" checked={sync.interactions && availableSync.interactions} onChange={(event) => onSync({ ...sync, interactions: event.currentTarget.checked })} disabled={disabled || !availableSync.interactions} />
          </label>
          {!availableSync.interactions && <p className="studio-controls__safety"><Icon name="info" /> Sur une URL, les clics et formulaires restent volontairement propres à chaque écran.</p>}
          <p className="studio-controls__safety"><Icon name="shield" /> Les formulaires, fichiers, mots de passe et actions destructives restent isolés.</p>
        </div>
      </details>

      <details className="studio-controls__popover" open={openPopover === 'overlay'}>
        <summary
          aria-label={`Régler la superposition d’une maquette — ${overlay.enabled ? 'active' : 'inactive'}`}
          aria-disabled={disabled || Boolean(overlayDisabledReason) || undefined}
          aria-expanded={openPopover === 'overlay'}
          aria-controls="studio-overlay-popover"
          onClick={(event) => {
            event.preventDefault()
            if (!disabled && !overlayDisabledReason) setOpenPopover((current) => current === 'overlay' ? null : 'overlay')
          }}
          title={overlayDisabledReason ?? undefined}
        >
          <Icon name="layers" />
          <span>Maquette</span>
          {overlay.enabled && <span className="studio-controls__live-dot" aria-label="Maquette active" />}
        </summary>
        <div id="studio-overlay-popover" className="studio-controls__popover-panel studio-controls__overlay-panel">
          <p className="studio-controls__popover-title">Superposition de référence</p>
          <p>Comparez le rendu à une image de design sans modifier le projet.</p>
          <input ref={imageInputRef} className="studio-controls__file" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={loadOverlay} tabIndex={-1} aria-hidden="true" />
          <button type="button" className="studio-secondary-button" onClick={chooseOverlay} disabled={disabled}>
            <Icon name="folder" /> {overlay.src ? 'Remplacer l’image' : 'Choisir une image'}
          </button>
          {overlay.src && <>
            <label className="studio-controls__opacity">
              <span>Opacité <strong>{Math.round(overlay.opacity * 100)} %</strong></span>
              <input
                type="range"
                min="0.05"
                max="1"
                step="0.05"
                value={overlay.opacity}
                onChange={(event) => onOverlay({ ...overlay, opacity: Number(event.currentTarget.value) })}
                disabled={disabled || !overlay.enabled}
              />
            </label>
            <label className="studio-switch-row studio-switch-row--compact">
              <span><Icon name="eye" /><span><strong>Afficher</strong><small>{overlay.fileName}</small></span></span>
              <input type="checkbox" checked={overlay.enabled} onChange={(event) => onOverlay({ ...overlay, enabled: event.currentTarget.checked })} disabled={disabled} />
            </label>
            <button type="button" className="studio-text-button studio-text-button--danger" onClick={clearOverlay} disabled={disabled}>
              <Icon name="remove" /> Retirer la maquette
            </button>
          </>}
        </div>
      </details>

      <button type="button" className="studio-controls__capture" onClick={onCapture} disabled={disabled || captureBusy || Boolean(captureDisabledReason)} aria-label={captureBusy ? 'Capture de la planche en cours' : captureDisabledReason ?? 'Capturer la planche d’écrans'} aria-busy={captureBusy || undefined} title={captureDisabledReason ?? undefined}>
        {captureBusy ? <i className="studio-controls__capture-spinner" aria-hidden="true" /> : <Icon name="camera" />}
        <span>{captureBusy ? 'Capture en cours…' : 'Capturer la planche'}</span>
      </button>
    </div>

    {(notice || savingSuite) && <div className="studio-controls__feedback" role="status">
      {notice && <span>{notice}</span>}
      {savingSuite
        ? <form onSubmit={saveCurrentSuite}>
          <label htmlFor="studio-suite-name">Nom de la suite</label>
          <input id="studio-suite-name" value={suiteName} maxLength={60} onChange={(event) => setSuiteName(event.currentTarget.value)} placeholder="Ex. Validation client" autoFocus aria-invalid={Boolean(suiteError)} aria-describedby={suiteError ? 'studio-suite-error' : undefined} />
          <button type="submit" className="studio-text-button"><Icon name="check" /> Enregistrer</button>
          <button type="button" className="studio-text-button" onClick={() => { setSavingSuite(false); setSuiteError(null) }}>Annuler</button>
          {suiteError && <span id="studio-suite-error" className="studio-field-error" role="alert">{suiteError}</span>}
        </form>
        : <div className="studio-controls__feedback-actions">
          <button type="button" className="studio-text-button" onClick={() => { setSavingSuite(true); setNotice(null) }} disabled={disabled}>
            <Icon name="plus" /> Enregistrer cette sélection
          </button>
          {activeSuiteMatches && activeSuite && !activeSuite.builtIn && <button type="button" className="studio-text-button studio-text-button--danger" onClick={deleteActivePersonalSuite} disabled={disabled}>
            <Icon name="remove" /> Supprimer « {activeSuite.name} »
          </button>}
          {notice && <button type="button" className="studio-icon-button studio-icon-button--quiet" aria-label="Fermer le message" onClick={() => setNotice(null)}><Icon name="close" /></button>}
        </div>}
    </div>}

    {libraryOpen && <div className="studio-library-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) setLibraryOpen(false)
    }}>
      <section ref={libraryDialogRef} className="studio-library" role="dialog" aria-modal="true" aria-labelledby="studio-library-title" aria-describedby="studio-library-description">
        <header className="studio-library__header">
          <div>
            <span className="studio-library__eyebrow">Bibliothèque locale</span>
            <h2 id="studio-library-title">Composer la planche d’écrans</h2>
            <p id="studio-library-description">Choisissez jusqu’à cinq formats. Aucun profil n’est chargé depuis Internet.</p>
          </div>
          <button type="button" className="studio-icon-button" onClick={() => setLibraryOpen(false)} aria-label="Fermer la bibliothèque"><Icon name="close" /></button>
        </header>

        <div className="studio-library__active" aria-label="Écrans actifs">
          <span className="studio-library__active-title">Planche actuelle <strong>{activeIds.length}/{MAX_ACTIVE_DEVICES}</strong></span>
          <div>
            {activeIds.map((id) => {
              const profile = findDeviceProfile(id, catalogState)
              return profile && <span className="studio-device-chip" key={id}>
                <Icon name={CATEGORY_ICONS[profile.category]} />
                {profile.name}
                <button type="button" onClick={() => removeDevice(id)} aria-label={`Retirer ${profile.name}`}><Icon name="close" size={14} /></button>
              </span>
            })}
          </div>
        </div>

        <div className="studio-library__tools">
          <label className="studio-library__search">
            <Icon name="search" />
            <span className="sr-only">Rechercher un appareil</span>
            <input ref={searchInputRef} type="search" value={search} onChange={(event) => setSearch(event.currentTarget.value)} placeholder="Modèle, marque, format…" />
          </label>
          <button type="button" className={showCustomForm ? 'studio-secondary-button is-active' : 'studio-secondary-button'} onClick={() => setShowCustomForm((value) => !value)}>
            <Icon name="plus" /> Format personnalisé
          </button>
        </div>

        {showCustomForm && <form className="studio-custom-device" onSubmit={submitCustomDevice}>
          <label>Nom<input required maxLength={60} value={customName} onChange={(event) => setCustomName(event.currentTarget.value)} placeholder="Ex. Borne tactile" /></label>
          <label>Catégorie<select value={customCategory} onChange={(event) => setCustomCategory(event.currentTarget.value as DeviceCategory)}>
            {Object.entries(CATEGORY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select></label>
          <label>Largeur<input required type="number" min="240" max="5120" step="1" value={customWidth} onChange={(event) => setCustomWidth(event.currentTarget.value)} /></label>
          <label>Hauteur<input required type="number" min="240" max="5120" step="1" value={customHeight} onChange={(event) => setCustomHeight(event.currentTarget.value)} /></label>
          <label>DPR<input required type="number" min="0.5" max="5" step="0.25" value={customDpr} onChange={(event) => setCustomDpr(event.currentTarget.value)} /></label>
          <button className="studio-primary-button" type="submit"><Icon name="check" /> Créer le format</button>
          {customError && <p className="studio-field-error" role="alert">{customError}</p>}
        </form>}

        <div className="studio-library__categories" role="group" aria-label="Filtrer par catégorie d’appareils">
          <button type="button" aria-pressed={category === 'all'} className={category === 'all' ? 'is-active' : undefined} onClick={() => setCategory('all')}>
            <Icon name="layout" /> Tous
          </button>
          {(Object.entries(CATEGORY_LABELS) as [DeviceCategory, string][]).map(([value, label]) => <button
            type="button"
            aria-pressed={category === value}
            className={category === value ? 'is-active' : undefined}
            key={value}
            onClick={() => setCategory(value)}
          ><Icon name={CATEGORY_ICONS[value]} /> {label}</button>)}
        </div>

        <div className="studio-library__results" role="list" aria-label="Appareils disponibles">
          {filteredProfiles.map((profile) => {
            const isActive = activeIds.includes(profile.id)
            const isFavorite = favoriteSet.has(profile.id)
            return <article className={isActive ? 'studio-device-card is-active' : 'studio-device-card'} role="listitem" key={profile.id}>
              <div className="studio-device-card__visual" aria-hidden="true">
                <span style={{ aspectRatio: `${profile.width} / ${profile.height}` }}><Icon name={CATEGORY_ICONS[profile.category]} /></span>
              </div>
              <div className="studio-device-card__copy">
                <span>{profile.brand}</span>
                <strong>{profile.name}</strong>
                <small>{compactDimensions(profile)}</small>
              </div>
              <button
                type="button"
                className={isFavorite ? 'studio-icon-button studio-device-card__favorite is-active' : 'studio-icon-button studio-device-card__favorite'}
                onClick={() => toggleFavorite(profile.id)}
                aria-pressed={isFavorite}
                aria-label={isFavorite ? `Retirer ${profile.name} des favoris` : `Ajouter ${profile.name} aux favoris`}
                title={isFavorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}
              ><Icon name="star" size={16} fill={isFavorite ? 'currentColor' : 'none'} /></button>
              <button
                type="button"
                className={isActive ? 'studio-device-card__select is-active' : 'studio-device-card__select'}
                onClick={() => isActive ? removeDevice(profile.id) : addDevice(profile.id)}
                disabled={!isActive && activeIds.length >= MAX_ACTIVE_DEVICES}
                aria-pressed={isActive}
              >
                <Icon name={isActive ? 'check' : 'plus'} /> {isActive ? 'Ajouté' : 'Ajouter'}
              </button>
            </article>
          })}
          {!filteredProfiles.length && <div className="studio-library__empty">
            <Icon name="search" />
            <strong>Aucun format correspondant</strong>
            <span>Modifiez la recherche ou créez un format personnalisé.</span>
          </div>}
        </div>

        <footer className="studio-library__footer">
          <span>{filteredProfiles.length} formats affichés · {profiles.length} disponibles</span>
          <button type="button" className="studio-primary-button" onClick={() => setLibraryOpen(false)}><Icon name="check" /> Utiliser cette planche</button>
        </footer>
      </section>
    </div>}
  </section>
}

export default StudioControls
