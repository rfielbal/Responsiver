import {
  ArrowLeft,
  ArrowRight,
  ArrowRightLeft,
  ArrowUpDown,
  Camera,
  Check,
  CircleAlert,
  CircleHelp,
  CirclePlus,
  Code2,
  Columns2,
  Copy,
  Crown,
  Crosshair,
  Download,
  Ellipsis,
  ExternalLink,
  Eye,
  EyeOff,
  FileText,
  Focus,
  Folder,
  Globe2,
  Grip,
  Grid3X3,
  Info,
  Keyboard,
  Laptop,
  Layers3,
  LayoutGrid,
  LayoutTemplate,
  Link2,
  LockKeyhole,
  Maximize2,
  MessageSquareText,
  Minimize2,
  Monitor,
  MoonStar,
  Mouse,
  MousePointer2,
  MousePointerClick,
  Move,
  MoveRight,
  Navigation,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  Plus,
  Redo2,
  RefreshCw,
  RotateCw,
  Route,
  Ruler,
  ScanLine,
  Search,
  Server,
  Settings2,
  ShieldCheck,
  Smartphone,
  Star,
  Tablet,
  Trash2,
  Undo2,
  Unlink2,
  UnlockKeyhole,
  X,
  ZoomIn,
  ZoomOut,
  type LucideIcon,
  type LucideProps
} from 'lucide-react'
import type { ReactElement } from 'react'

/**
 * Catalogue local unique de Responsiver.
 *
 * Plusieurs noms fonctionnels peuvent volontairement pointer vers le même
 * glyphe : les composants restent ainsi indépendants du vocabulaire interne
 * de Lucide et une future évolution graphique ne touche qu'à ce fichier.
 */
const ICONS = {
  // Navigation historique de l'application
  projects: Folder,
  ruler: Ruler,
  matrix: Grid3X3,
  changes: ArrowUpDown,
  export: Download,
  folder: Folder,
  file: FileText,
  code: Code2,
  phone: Smartphone,
  tablet: Tablet,
  laptop: Laptop,
  finding: CircleAlert,
  theme: MoonStar,
  chat: MessageSquareText,
  shield: ShieldCheck,
  back: ArrowLeft,
  forward: ArrowRight,
  refresh: RefreshCw,
  swap: ArrowRightLeft,
  panelCollapse: PanelLeftClose,
  panelExpand: PanelLeftOpen,
  close: X,
  check: Check,
  copy: Copy,
  arrow: MoveRight,
  plus: Plus,
  compare: Columns2,
  external: ExternalLink,
  fullscreen: Maximize2,
  fullscreenExit: Minimize2,
  info: Info,
  help: CircleHelp,
  cursor: MousePointer2,
  compose: Move,
  undo: Undo2,
  redo: Redo2,
  play: Play,

  // Dispositions et pilotage du Studio multi-écrans
  layout: LayoutTemplate,
  grid: LayoutGrid,
  focus: Focus,
  link: Link2,
  unlink: Unlink2,
  crown: Crown,
  pilot: Crosshair,
  layers: Layers3,
  monitor: Monitor,
  deviceAdd: CirclePlus,
  isolate: Focus,

  // Capture, manipulation et bibliothèque d'appareils
  camera: Camera,
  screenshot: Camera,
  fullPage: ScanLine,
  drag: Grip,
  search: Search,
  star: Star,
  remove: Trash2,
  rotate: RotateCw,
  zoom: ZoomIn,
  zoomIn: ZoomIn,
  zoomOut: ZoomOut,

  // Navigation distante et synchronisation
  route: Route,
  navigation: Navigation,
  address: Link2,
  globe: Globe2,
  server: Server,
  sync: RefreshCw,
  syncOff: Unlink2,
  touch: MousePointerClick,
  keyboard: Keyboard,
  scroll: Mouse,
  lock: LockKeyhole,
  unlock: UnlockKeyhole,
  eye: Eye,
  eyeOff: EyeOff,

  // Actions secondaires
  more: Ellipsis,
  settings: Settings2
} as const satisfies Record<string, LucideIcon>

export type IconName = keyof typeof ICONS

export const ICON_FALLBACK: IconName = 'help'

export function isIconName(value: string): value is IconName {
  return Object.prototype.hasOwnProperty.call(ICONS, value)
}

export interface IconProps extends Omit<LucideProps, 'ref' | 'size'> {
  name: IconName
  size?: number | string
}

/**
 * Icône décorative par défaut. Pour une icône porteuse d'information seule,
 * fournir `aria-hidden={false}` et un `aria-label` explicite. Les boutons qui
 * l'emploient doivent continuer à porter leur propre libellé accessible.
 */
export function Icon({
  name,
  size = 18,
  strokeWidth = 1.75,
  'aria-hidden': ariaHidden = true,
  ...props
}: IconProps): ReactElement {
  // La garde reste utile à l'exécution pour les préférences persistées ou les
  // appels JavaScript non typés, même si TypeScript contraint les appels React.
  const requestedName = name as string
  const fellBack = !isIconName(requestedName)
  const Glyph = fellBack ? ICONS[ICON_FALLBACK] : ICONS[requestedName]

  return <Glyph
    {...props}
    size={size}
    strokeWidth={strokeWidth}
    aria-hidden={ariaHidden}
    focusable="false"
    data-icon-name={fellBack ? ICON_FALLBACK : requestedName}
    data-icon-fallback={fellBack || undefined}
  />
}

export default Icon
