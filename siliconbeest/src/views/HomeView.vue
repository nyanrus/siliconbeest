<script setup lang="ts">
import { computed, ref, watch, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTimelinesStore } from '@/stores/timelines'
import { useStatusesStore } from '@/stores/statuses'
import { useAuthStore } from '@/stores/auth'
import { useUiStore } from '@/stores/ui'
import type { Status } from '@/types/mastodon'
import AppShell from '@/components/layout/AppShell.vue'
import TimelineFeed from '@/components/timeline/TimelineFeed.vue'
import AnnouncementBanner from '@/components/common/AnnouncementBanner.vue'

const { t } = useI18n()
const timelinesStore = useTimelinesStore()
const statusesStore = useStatusesStore()
const auth = useAuthStore()
const ui = useUiStore()

const timeline = computed(() => timelinesStore.getTimeline('home'))

const statuses = computed(() => {
  return timeline.value.statusIds
    .map((id) => statusesStore.getCached(id))
    .filter((s): s is Status => !!s)
})

const hasNewPosts = computed(() => timeline.value.newStatusIds.length > 0)

// New posts behavior:
// - At scroll top: auto-insert immediately (no banner)
// - Scrolled down: show banner, click to load
// - Scroll back to top: auto-insert pending new posts
const isAtTop = ref(true)
let scrollTimer: ReturnType<typeof setTimeout> | null = null

function handleScroll() {
  if (scrollTimer) return
  scrollTimer = setTimeout(() => {
    isAtTop.value = window.scrollY < 50
    scrollTimer = null
  }, 100)
}

onMounted(() => window.addEventListener('scroll', handleScroll, { passive: true }))
onUnmounted(() => {
  window.removeEventListener('scroll', handleScroll)
  if (scrollTimer) clearTimeout(scrollTimer)
})

// When new posts arrive while at top → auto-insert
watch(() => timeline.value.newStatusIds.length, (len) => {
  if (len > 0 && isAtTop.value) {
    timelinesStore.showNewStatuses('home')
  }
})

// When user scrolls back to top and there are pending posts → auto-insert
watch(isAtTop, (atTop) => {
  if (atTop && timeline.value.newStatusIds.length > 0) {
    timelinesStore.showNewStatuses('home')
  }
})

async function loadTimeline() {
  if (!auth.token) return
  await timelinesStore.fetchTimeline('home', { token: auth.token })
}

async function loadMore() {
  if (!auth.token) return
  await timelinesStore.fetchMore('home', { token: auth.token })
}

function showNew() {
  timelinesStore.showNewStatuses('home')
}

onMounted(loadTimeline)
</script>

<template>
  <AppShell>
    <div>
      <!-- Header -->
      <header class="sticky top-0 z-10 bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm border-b border-gray-200 dark:border-gray-700 px-4 py-3 flex items-center justify-between">
        <h1 class="text-xl font-bold">{{ t('nav.home') }}</h1>
        <button
          v-if="auth.isAuthenticated"
          @click="ui.openComposeModal()"
          class="px-4 py-1.5 rounded-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-sm transition-colors"
        >
          {{ t('nav.compose') }}
        </button>
      </header>

      <!-- Announcements -->
      <AnnouncementBanner />

      <!-- Error -->
      <div v-if="timeline.error" class="p-4 text-center text-red-500">
        {{ timeline.error }}
      </div>

      <!-- Feed -->
      <TimelineFeed
        :statuses="statuses"
        :loading="timeline.loading || timeline.loadingMore"
        :done="!timeline.hasMore"
        :has-new-posts="hasNewPosts && !isAtTop"
        :new-posts-count="timeline.newStatusIds.length"
        @load-more="loadMore"
        @load-new="showNew"
      />
    </div>
  </AppShell>
</template>
