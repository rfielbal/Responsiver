#!/usr/bin/env node

import path from 'node:path'

const HOST_NAME = 'fr.responsiver.desktop'
const EXTENSION_ID_PATTERN = /^[a-p]{32}$/

function fail(message) {
  process.stderr.write(`${message}\n`)
  process.exitCode = 1
}

function parseArguments(argv) {
  const values = new Map()
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (!token.startsWith('--')) throw new Error(`Argument inconnu : ${token}`)
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) throw new Error(`Valeur manquante pour ${token}`)
    values.set(token.slice(2), value)
    index += 1
  }
  return values
}

function normalizePlatform(value) {
  if (value === 'mac' || value === 'macos' || value === 'darwin') return 'macos'
  if (value === 'win' || value === 'windows' || value === 'win32') return 'windows'
  if (value === 'linux') return 'linux'
  throw new Error('La plateforme doit être macos, windows ou linux.')
}

function isAbsoluteForPlatform(value, platform) {
  return platform === 'windows' ? path.win32.isAbsolute(value) : path.posix.isAbsolute(value)
}

function manifestLocation(platform) {
  if (platform === 'macos') {
    return '~/Library/Application Support/Google/Chrome/NativeMessagingHosts/fr.responsiver.desktop.json'
  }
  if (platform === 'linux') {
    return '~/.config/google-chrome/NativeMessagingHosts/fr.responsiver.desktop.json'
  }
  return '%LOCALAPPDATA%\\Responsiver\\NativeMessagingHosts\\fr.responsiver.desktop.json'
}

function registrationInstructions(platform, location) {
  if (platform !== 'windows') {
    return [
      `Créer manuellement le dossier parent de : ${location}`,
      'Copier exactement le contenu de manifest dans ce fichier.',
      'Limiter les droits du manifeste à votre compte utilisateur.',
      'Rendre le programme hostPath exécutable, puis relancer Chrome.'
    ]
  }

  return [
    `Enregistrer manuellement le manifeste à : ${location}`,
    `Créer dans HKEY_CURRENT_USER\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`,
    'Définir la valeur par défaut de cette clé avec le chemin absolu du manifeste.',
    'Ne pas utiliser HKEY_LOCAL_MACHINE pour une installation personnelle.',
    'Relancer Chrome.'
  ]
}

function printUsage() {
  process.stdout.write(
    'Usage : node native-host/register.mjs --platform macos|windows|linux --extension-id <32 caractères> --host-path <chemin absolu> [--format plan|manifest]\n' +
      'Ce programme affiche un plan et ne modifie aucun fichier, registre ou réglage système.\n'
  )
}

let argumentsMap
try {
  argumentsMap = parseArguments(process.argv.slice(2))
} catch (error) {
  fail(error.message)
  printUsage()
}

if (argumentsMap) {
  try {
    const platform = normalizePlatform(argumentsMap.get('platform'))
    const extensionId = argumentsMap.get('extension-id')
    const hostPath = argumentsMap.get('host-path')
    const format = argumentsMap.get('format') ?? 'plan'

    if (!extensionId || !EXTENSION_ID_PATTERN.test(extensionId)) {
      throw new Error('L’identifiant Chrome doit contenir 32 caractères compris entre a et p.')
    }
    if (!hostPath || !isAbsoluteForPlatform(hostPath, platform)) {
      throw new Error('Le chemin du connecteur doit être absolu pour la plateforme choisie.')
    }
    if (format !== 'plan' && format !== 'manifest') {
      throw new Error('Le format doit être plan ou manifest.')
    }

    const location = manifestLocation(platform)
    const plan = {
      dryRun: true,
      notice: 'Aucune modification système n’a été effectuée.',
      platform,
      manifestLocation: location,
      manifest: {
        name: HOST_NAME,
        description: 'Pont local minimal entre Chrome et Responsiver',
        path: hostPath,
        type: 'stdio',
        allowed_origins: [`chrome-extension://${extensionId}/`]
      },
      manualSteps: registrationInstructions(platform, location)
    }

    process.stdout.write(`${JSON.stringify(format === 'manifest' ? plan.manifest : plan, null, 2)}\n`)
  } catch (error) {
    fail(error.message)
    printUsage()
  }
}
