const { execFileSync } = require('node:child_process')
const { join } = require('node:path')

const unusedPermissionDescriptions = [
  'NSAudioCaptureUsageDescription',
  'NSBluetoothAlwaysUsageDescription',
  'NSBluetoothPeripheralUsageDescription',
  'NSCameraUsageDescription',
  'NSMicrophoneUsageDescription'
]

module.exports = async function removeUnusedMacPermissions(context) {
  if (context.electronPlatformName !== 'darwin') return
  const plist = join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
    'Contents',
    'Info.plist'
  )

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
