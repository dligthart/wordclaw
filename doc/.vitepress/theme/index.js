import DefaultTheme from 'vitepress/theme'
import { useData, useRoute } from 'vitepress'
import { nextTick, watch } from 'vue'
import mermaid from 'mermaid'
import './custom.css'

let renderCounter = 0

function extractMermaidSource(block) {
  const code = block.querySelector('code')
  if (!code) {
    return ''
  }

  // Shiki wraps each source line in `.line`; join explicitly so Mermaid parsing
  // preserves line breaks for complex flowcharts.
  const shikiLines = code.querySelectorAll('.line')
  if (shikiLines.length > 0) {
    return Array.from(shikiLines)
      .map((line) => line.textContent ?? '')
      .join('\n')
      .trim()
  }

  return code.textContent?.trim() ?? ''
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

  try {
    mermaid.initialize(buildMermaidConfig(isDark))
  } catch (error) {
    console.error('[docs] Failed to initialize Mermaid', error)
    return
  }

  const blocks = Array.from(document.querySelectorAll('.language-mermaid'))
  for (const block of blocks) {
    const source = block.dataset.mermaidSource || extractMermaidSource(block)
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
