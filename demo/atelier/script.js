(() => {
  const state = { items: [] }
  const bag = document.querySelector('[data-bag-panel]')
  const scrim = document.querySelector('[data-scrim]')
  const list = document.querySelector('[data-bag-list]')
  const empty = document.querySelector('[data-bag-empty]')

  const renderBag = () => {
    document.querySelectorAll('[data-bag-count]').forEach((count) => { count.textContent = String(state.items.length) })
    if (!list || !empty) return
    list.replaceChildren(...state.items.map((name) => {
      const item = document.createElement('li')
      item.textContent = name
      return item
    }))
    empty.hidden = state.items.length > 0
  }

  const setBag = (open) => {
    if (!bag || !scrim) return
    bag.classList.toggle('is-open', open)
    bag.setAttribute('aria-hidden', String(!open))
    scrim.hidden = !open
  }

  document.querySelectorAll('[data-add]').forEach((button) => button.addEventListener('click', () => {
    state.items.push(button.dataset.add || 'Objet')
    renderBag()
    setBag(true)
  }))
  document.querySelectorAll('[data-bag]').forEach((button) => button.addEventListener('click', () => setBag(true)))
  document.querySelectorAll('[data-bag-close]').forEach((button) => button.addEventListener('click', () => setBag(false)))
  scrim?.addEventListener('click', () => setBag(false))
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') setBag(false) })

  document.querySelectorAll('[data-filter]').forEach((button) => button.addEventListener('click', () => {
    document.querySelectorAll('[data-filter]').forEach((item) => item.classList.remove('is-active'))
    button.classList.add('is-active')
    const filter = button.dataset.filter
    document.querySelectorAll('[data-material]').forEach((product) => {
      product.hidden = filter !== 'all' && product.dataset.material !== filter
    })
  }))

  renderBag()
})()
