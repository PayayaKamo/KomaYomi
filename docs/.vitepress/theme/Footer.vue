<script setup lang="ts">
import { computed } from 'vue'
import { useData } from 'vitepress'
import { buildInfo } from './build-info'

const { page } = useData()

const footerText = {
  en: {
    tagline: 'Local-first, panel-by-panel manga intensive reading.',
    author: 'Author homepages:',
    copyright: '© 2026 PayayaKamo · KomaYomi（格读）',
    build: 'Build',
  },
  zh: {
    tagline: '本地优先，以格为单位的漫画精读。',
    author: '作者主页：',
    copyright: '© 2026 PayayaKamo · KomaYomi（格读）',
    build: '构建',
  },
  ja: {
    tagline: 'ローカル優先・コマ単位の漫画精読。',
    author: '作者ページ：',
    copyright: '© 2026 PayayaKamo · KomaYomi（格读）',
    build: 'ビルド',
  },
} as const

const locale = computed<'en' | 'zh' | 'ja'>(() => {
  const relativePath = page.value.relativePath || ''
  if (relativePath.startsWith('zh/')) return 'zh'
  if (relativePath.startsWith('ja/')) return 'ja'
  return 'en'
})

const text = computed(() => footerText[locale.value])

// CI builds link to the commit; local builds have no hash to link to.
const commitUrl = computed(() =>
  buildInfo.shaFull
    ? `https://github.com/PayayaKamo/KomaYomi/commit/${buildInfo.shaFull}`
    : '',
)
</script>

<template>
  <footer class="mm-footer">
    <div class="mm-footer__inner">
      <p class="mm-footer__tagline">{{ text.tagline }}</p>
      <p class="mm-footer__copy">{{ text.copyright }}</p>
      <p class="mm-footer__author">
        <span>{{ text.author }}</span>
        <a href="https://x.com/payayakamo" target="_blank" rel="noopener noreferrer"
          >X · @payayakamo</a
        >
        <span class="mm-footer__sep" aria-hidden="true">·</span>
        <a href="https://note.com/payayakamo" target="_blank" rel="noopener noreferrer"
          >note · @payayakamo</a
        >
      </p>
      <p class="mm-footer__build">
        <span>{{ text.build }}</span>
        <a v-if="commitUrl" :href="commitUrl">{{ buildInfo.shaShort }}</a>
        <span v-else class="mm-footer__sha">{{ buildInfo.shaShort }}</span>
        <span class="mm-footer__sep" aria-hidden="true">·</span>
        <time>{{ buildInfo.time }}</time>
      </p>
    </div>
  </footer>
</template>
