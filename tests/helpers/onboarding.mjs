export async function dismissOnboardingIfPresent(page) {
  await page.waitForLoadState('domcontentloaded')
  const hidden = await page.evaluate(() => {
    try { return window.localStorage.getItem('responsiver.onboarding.v1.hidden') === 'true' } catch { return false }
  })
  if (hidden) return
  const dialog = page.getByRole('dialog', { name: 'Prise en main de Responsiver' })
  await dialog.waitFor({ state: 'visible', timeout: 12_000 })
  await dialog.getByRole('button', { name: 'Passer pour le moment' }).click()
  await dialog.waitFor({ state: 'hidden' })
}
