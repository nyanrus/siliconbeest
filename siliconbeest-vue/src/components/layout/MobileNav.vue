<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth'
import { useUiStore } from '@/stores/ui'

const { t } = useI18n()
const auth = useAuthStore()
const ui = useUiStore()

const profilePath = computed(() => {
  const acct = auth.currentUser?.acct
  return acct ? `/@${acct}` : '/settings'
})

const tabs = computed(() => [
  { key: 'home', path: '/home', icon: '🏠', action: null },
  { key: 'search', path: '/search', icon: '🔍', action: null },
  { key: 'compose', path: null, icon: '➕', action: () => ui.openComposeModal() },
  { key: 'notifications', path: '/notifications', icon: '🔔', action: null },
  { key: 'profile', path: profilePath.value, icon: '👤', action: null },
])

function handleTab(tab: { path: string | null; action: (() => void) | null }) {
  if (tab.action) {
    tab.action()
  }
}
</script>

<template>
  <nav
    class="fixed bottom-0 left-0 right-0 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700 z-50"
    aria-label="Mobile navigation"
  >
    <ul class="flex justify-around items-center h-14">
      <li v-for="tab in tabs" :key="tab.key">
        <router-link
          v-if="tab.path"
          :to="tab.path"
          class="flex flex-col items-center justify-center w-14 h-14 text-gray-500 dark:text-gray-400 transition-colors"
          active-class="text-indigo-600 dark:text-indigo-400"
          :aria-label="t(`nav.${tab.key}`)"
        >
          <span class="text-xl" aria-hidden="true">{{ tab.icon }}</span>
        </router-link>
        <button
          v-else
          @click="handleTab(tab)"
          class="flex flex-col items-center justify-center w-14 h-14 text-gray-500 dark:text-gray-400 transition-colors"
          :aria-label="t(`nav.${tab.key}`)"
        >
          <span class="text-xl" aria-hidden="true">{{ tab.icon }}</span>
        </button>
      </li>
    </ul>
  </nav>
</template>
