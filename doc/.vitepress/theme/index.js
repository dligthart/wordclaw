import DefaultTheme from 'vitepress/theme'
import { useData, useRoute } from 'vitepress'
import { nextTick, watch } from 'vue'
import './custom.css'

let mermaidLoader
let renderCounter = 0

function getMermaid() {
  if (!mermaidLoader) {
    const fromJsDelivr = import(
      /* @vite-ignore */ 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs'
    )
    const fromUnpkg = import(
      /* @vite-ignore */ 'https://unpkg.com/mermaid@11/dist/mermaid.esm.min.mjs'
    )

    mermaidLoader = fromJsDelivr
      .catch(() => fromUnpkg)
      .then((module) => module.default ?? module)
  }

  return mermaidLoader
}

function buildMermaidConfig(isDark) {
  return {
    startOnLoad: false,
    securityLevel: 'strict',
    theme: isDark ? 'dark' : 'default',
    flowchart: { curve: 'basis', useMaxWidth: true, htmlLabels: true },
    sequence: { useMaxWidth: true, wrap: true },
    er: { useMaxWidth: true }
  }
}

async function renderMermaidBlocks(isDark) {
  if (typeof window === 'undefined') {
    return
  }

  await nextTick()

  let mermaid
  try {
    mermaid = await getMermaid()
  } catch (error) {
    console.error('[docs] Failed to load Mermaid from CDN', error)
    return
  }

  mermaid.initialize(buildMermaidConfig(isDark))

  const blocks = Array.from(document.querySelectorAll('.language-mermaid'))
  for (const block of blocks) {
    const source = block.dataset.mermaidSource || block.querySelector('code')?.textContent?.trim()
    if (!source) {
      continue
    }

    block.dataset.mermaidSource = source

    if (
      block.dataset.mermaidRendered === 'true' &&
      block.dataset.mermaidTheme === String(isDark)
    ) {
      continue
    }

    try {
      const id = `wordclaw-mermaid-${renderCounter++}`
      const { svg, bindFunctions } = await mermaid.render(id, source)
      block.classList.add('mermaid-rendered')
      block.innerHTML = `<div class="mermaid-wrapper">${svg}</div>`
      block.dataset.mermaidRendered = 'true'
      block.dataset.mermaidTheme = String(isDark)
      bindFunctions?.(block.querySelector('.mermaid-wrapper'))
    } catch (error) {
      console.error('[docs] Failed to render Mermaid diagram', error)
    }
  }
}

export default {
  extends: DefaultTheme,
  setup() {
    if (typeof window === 'undefined') {
      return
    }

    const route = useRoute()
    const { isDark } = useData()

    const rerender = () => {
      window.requestAnimationFrame(() => {
        renderMermaidBlocks(Boolean(isDark.value))
      })
    }

    watch(() => route.path, rerender, { immediate: true })
    watch(isDark, rerender)
  }
}
