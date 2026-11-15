<script setup lang="ts">
import { computed } from 'vue'
import { useData } from 'vitepress'
import { buildInfo } from './build-info'

const { page } = useData()

const footerText = {
  en: {
    tagline: 'Learn languages with manga, take notes.',
    copyright: '© 2026 PayayaKamo · KomaYomi — Manga Learner',
    build: 'Build',
  },
  zh: {
    tagline: '用漫画学语言，做笔记。',
    copyright: '© 2026 PayayaKamo · KomaYomi — Manga Learner',
    build: '构建',
  },
  ja: {
    tagline: '漫画で言語を学び、ノートを取る。',
    copyright: '© 2026 PayayaKamo · KomaYomi — Manga Learner',
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
