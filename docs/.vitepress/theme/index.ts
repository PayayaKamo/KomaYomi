import DefaultTheme from 'vitepress/theme'
import { inBrowser } from 'vitepress'
import Layout from './Layout.vue'
import './custom.css'

const outlineText = {
  en: { open: 'Contents', close: 'Expand', title: 'Toggle table of contents' },
  zh: { open: '目录', close: '展开', title: '折叠或展开本页目录' },
  ja: { open: '目次', close: '展開', title: '目次の折りたたみ' },
}

function setupOutlineToggle() {
  if (!inBrowser) return
  const lang = document.documentElement.lang || 'en'
  const labels = lang.startsWith('zh') ? outlineText.zh : lang.startsWith('ja') ? outlineText.ja : outlineText.en

  let button = document.getElementById('outline-toggle') as HTMLButtonElement | null
  if (!button) {
    button = document.createElement('button')
    button.id = 'outline-toggle'
    button.addEventListener('click', () => {
      document.body.classList.toggle('hide-outline')
      try {
        localStorage.setItem(
          'komayomi-outline-hidden',
          document.body.classList.contains('hide-outline') ? '1' : '0',
        )
      } catch {
        /* storage may be unavailable */
      }
      update()
    })
    document.body.appendChild(button)
  }

  function update() {
    if (!button) return
    const hidden = document.body.classList.contains('hide-outline')
    button.classList.toggle('active', hidden)
    button.textContent = hidden ? labels.close : labels.open
    button.title = labels.title
    button.setAttribute('aria-label', labels.title)
  }

  try {
    if (localStorage.getItem('komayomi-outline-hidden') === '1') {
      document.body.classList.add('hide-outline')
    }
  } catch {
    /* storage may be unavailable */
  }

  update()
}

export default {
  extends: DefaultTheme,
  Layout,
  enhanceApp({ router }: { router?: any }) {
    if (!inBrowser) return

    // Open external links in a new tab without leaking the referrer or
    // giving the new page access to window.opener.
    window.addEventListener('click', (event) => {
      if (event.defaultPrevented) return
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return
      }
      const target = event.target as HTMLElement | null
      const anchor = target?.closest?.('a') as HTMLAnchorElement | null
      if (!anchor) return
      const href = anchor.getAttribute('href') || ''
      if (!/^https?:\/\//i.test(href)) return
      let url: URL
      try {
        url = new URL(href)
      } catch {
        return
      }
      if (url.origin === window.location.origin) return
      event.preventDefault()
      window.open(url.href, '_blank', 'noopener,noreferrer')
    })

    // Floating outline toggle, matching the reference documentation site.
    setTimeout(setupOutlineToggle, 0)
    if (router?.onAfterRouteChanged) {
      const original = router.onAfterRouteChanged
      router.onAfterRouteChanged = () => {
        original?.()
        setTimeout(setupOutlineToggle, 0)
      }
    }
  },
}
