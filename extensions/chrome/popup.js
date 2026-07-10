const button = document.querySelector('#open-button')
const buttonLabel = button.querySelector('span')
const status = document.querySelector('#status')
const statusTitle = document.querySelector('#status-title')
const statusDetail = document.querySelector('#status-detail')

function setStatus(tone, title, detail) {
  status.hidden = false
  status.dataset.tone = tone
  statusTitle.textContent = title
  statusDetail.textContent = detail
}

function clearStatus() {
  status.hidden = true
  delete status.dataset.tone
  statusTitle.textContent = ''
  statusDetail.textContent = ''
}

function setLoading(loading) {
  button.disabled = loading
  button.dataset.loading = String(loading)
  buttonLabel.textContent = loading ? 'Connexion locale…' : 'Ouvrir dans Responsiver'
}

function sendOpenRequest() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      {
        type: 'OPEN_ACTIVE_TAB',
        devicePixelRatio: window.devicePixelRatio
      },
      (response) => {
        const runtimeError = chrome.runtime.lastError
        if (runtimeError) {
          resolve({
            ok: false,
            error: {
              code: 'EXTENSION_ERROR',
              message: 'Le compagnon Chrome ne répond pas. Rechargez l’extension.'
            }
          })
          return
        }
        resolve(response)
      }
    )
  })
}

button.addEventListener('click', async () => {
  clearStatus()
  setLoading(true)

  try {
    const response = await sendOpenRequest()
    if (response?.ok) {
      setStatus(
        'success',
        'Demande validée localement',
        'Le connecteur l’a placée dans la file privée. Ouvrez Responsiver pour confirmer le chargement de la page.'
      )
      buttonLabel.textContent = 'Mise en attente locale'
      return
    }

    if (response?.error?.code === 'APP_UNAVAILABLE') {
      setStatus(
        'error',
        'Application introuvable',
        'Installez Responsiver et son connecteur local, puis réessayez.'
      )
      return
    }

    setStatus(
      'error',
      'Ouverture impossible',
      response?.error?.message || 'Responsiver n’a pas accepté cette page.'
    )
  } catch {
    setStatus('error', 'Ouverture impossible', 'Une erreur inattendue est survenue dans l’extension.')
  } finally {
    setLoading(false)
  }
})
