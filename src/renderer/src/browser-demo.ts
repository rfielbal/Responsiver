const previewHtml = `<!doctype html><html lang="fr"><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;color:#172033;background:#fff;font:16px system-ui}.top{display:flex;justify-content:space-between;padding:18px 7vw;border-bottom:1px solid #e8ebf2}.brand{font-weight:800}.links{display:flex;gap:20px;color:#516078}.hero{display:grid;grid-template-columns:1.1fr .9fr;gap:30px;padding:68px 7vw;background:#f6f8ff}h1{margin:0;font-size:clamp(34px,6vw,66px);letter-spacing:-.07em;line-height:.95}.hero p{color:#56637a;line-height:1.55}.button{display:inline-block;padding:12px 16px;background:#315cf5;color:white;border-radius:8px}.visual{min-height:230px;border-radius:18px;background:linear-gradient(145deg,#c9d6ff,#edf3ff)}.metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;padding:36px 7vw}.metric{padding:16px;border:1px solid #e7eaf1;border-radius:11px}@media(max-width:640px){.links{display:none}.hero{grid-template-columns:1fr;padding:42px 24px}.visual{min-height:150px}.metrics{grid-template-columns:1fr;padding:24px}}</style></head><body><header class="top"><span class="brand">ATELIER ATLAS</span><nav class="links"><span>Solutions</span><span>Références</span><span>Contact</span></nav></header><main><section class="hero"><div><p>Architecture intérieure</p><h1>Des espaces qui racontent une histoire.</h1><p>Un projet de démonstration local pour visualiser des changements de largeur.</p><a class="button">Découvrir le studio</a></div><div class="visual"></div></section><section class="metrics"><article class="metric"><strong>18</strong><br>projets livrés</article><article class="metric"><strong>12 ans</strong><br>d'expertise</article><article class="metric"><strong>100 %</strong><br>sur mesure</article></section></main></body></html>`

export const browserDemoProject: ProjectSnapshot = {
  id: 'browser-demo-atlas',
  name: 'Atelier Atlas',
  root: 'Projet de démonstration local',
  kind: 'Démo statique',
  files: 28,
  analyzedAt: new Date().toISOString(),
  previewHtml,
  issues: [
    {
      id: 'demo-viewport',
      title: 'Balise viewport absente',
      description: 'Le navigateur mobile peut conserver une largeur de mise en page de bureau.',
      severity: 'bloquant',
      coverage: 'standard',
      viewport: 'Tous les téléphones',
      source: { file: 'index.html', line: 4 },
      rule: 'html.viewport-meta',
      proposal: 'Ajouter la balise viewport standard.'
    },
    {
      id: 'demo-navigation',
      title: 'Navigation trop large',
      description: 'Un conteneur de 760 px déborde à 390 px.',
      severity: 'attention',
      coverage: 'heuristique',
      viewport: '390 × 844',
      source: { file: 'styles/navigation.css', line: 18 },
      rule: 'css.fixed-width',
      proposal: 'Activer flex-wrap sous 640 px et limiter la largeur à 100 %.'
    },
    {
      id: 'demo-theme',
      title: 'Thème sombre non couvert',
      description: 'Aucune préférence de couleur ni variable sémantique n’a été trouvée.',
      severity: 'information',
      coverage: 'manuel',
      viewport: 'Clair / sombre',
      source: { file: 'styles/tokens.css', line: 1 },
      rule: 'theme.color-scheme',
      proposal: 'Créer une couche de variables CSS pour le mode sombre.'
    }
  ]
}

