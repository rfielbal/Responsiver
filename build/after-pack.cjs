const { execFileSync } = require('node:child_process')
const { accessSync, constants } = require('node:fs')
const { join } = require('node:path')

const unusedPermissionDescriptions = [
  'NSAudioCaptureUsageDescription',
  'NSBluetoothAlwaysUsageDescription',
  'NSBluetoothPeripheralUsageDescription',
  'NSCameraUsageDescription',
  'NSMicrophoneUsageDescription'
]

module.exports = async function hardenPackage(context) {
  const applicationRoot = context.electronPlatformName === 'darwin'
    ? join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents')
    : context.appOutDir
  const resources = join(applicationRoot, context.electronPlatformName === 'darwin' ? 'Resources' : 'resources')
  for (const notice of ['LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md', 'PRIVACY.md', 'SECURITY.md']) {
    accessSync(join(resources, notice), constants.R_OK)
  }
  for (const companionResource of [
    join('companion', 'chrome', 'manifest.json'),
    join('companion', 'chrome', 'icon.png'),
    join('companion', 'chrome', 'service-worker.js'),
    join('companion', 'chrome', 'url-policy.mjs'),
    join('companion', 'chrome', 'popup.html'),
    join('companion', 'chrome', 'popup.css'),
    join('companion', 'chrome', 'popup.js'),
    join('companion', 'chrome', 'README.md'),
    join('companion', 'native-host', 'host.mjs'),
    join('companion', 'native-host', 'protocol.mjs'),
    join('companion', 'native-host', 'url-policy.mjs'),
    join('companion', 'native-host', 'spool.mjs'),
    join('companion', 'native-host', 'register.mjs'),
    join('companion', 'native-host', 'README.md'),
    join('companion', 'native-host', 'manifests', 'macos.json.template'),
    join('companion', 'native-host', 'manifests', 'windows.json.template'),
    join('companion', 'native-host', 'manifests', 'linux.json.template')
  ]) {
    accessSync(join(resources, companionResource), constants.R_OK)
  }

  if (context.electronPlatformName !== 'darwin') return
  const plist = join(applicationRoot, 'Info.plist')

  for (const key of unusedPermissionDescriptions) {
    try {
      execFileSync('/usr/libexec/PlistBuddy', ['-c', `Delete :${key}`, plist], { stdio: 'ignore' })
    } catch {
      // Les versions d’Electron qui n’ajoutent pas cette clé n’exigent aucune action.
    }
  }

  execFileSync('/usr/libexec/PlistBuddy', [
    '-c',
    'Set :NSAppTransportSecurity:NSAllowsArbitraryLoads false',
    plist
  ], { stdio: 'ignore' })
}
