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
  for (const notice of ['LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md']) {
    accessSync(join(resources, notice), constants.R_OK)
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
