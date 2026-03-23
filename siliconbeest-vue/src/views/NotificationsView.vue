<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useNotificationsStore } from '@/stores/notifications'
import { useAuthStore } from '@/stores/auth'
import AppShell from '@/components/layout/AppShell.vue'
import NotificationItem from '@/components/notification/NotificationItem.vue'
import InfiniteScroll from '@/components/common/InfiniteScroll.vue'
import LoadingSpinner from '@/components/common/LoadingSpinner.vue'

const { t } = useI18n()
const notificationsStore = useNotificationsStore()
const auth = useAuthStore()

const notifications = computed(() => notificationsStore.items)
const loading = computed(() => notificationsStore.loading)
const loadingMore = computed(() => notificationsStore.loadingMore)
const done = computed(() => !notificationsStore.hasMore)
const error = computed(() => notificationsStore.error)

async function loadNotifications() {
  if (!auth.token) return
  await notificationsStore.fetch(auth.token)
  notificationsStore.markAllRead()
}

async function loadMore() {
  if (!auth.token) return
  await notificationsStore.fetchMore(auth.token)
}

async function clearAll() {
  if (!auth.token) return
  await notificationsStore.clearAll(auth.token)
}

onMounted(loadNotifications)
</script>

<template>
  <AppShell>
    <div>
      <header class="sticky top-0 z-10 bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm border-b border-gray-200 dark:border-gray-700 px-4 py-3 flex items-center justify-between">
        <h1 class="text-xl font-bold">{{ t('nav.notifications') }}</h1>
        <button
          v-if="notifications.length > 0"
          @click="clearAll"
          class="text-sm text-gray-500 dark:text-gray-400 hover:text-red-500 transition-colors"
        >
          {{ t('notifications.clear_all') }}
        </button>
      </header>

      <div v-if="error" class="p-4 text-center text-red-500">
        {{ error }}
      </div>

      <InfiniteScroll :loading="loading || loadingMore" :done="done" @load-more="loadMore">
        <NotificationItem
          v-for="notification in notifications"
          :key="notification.id"
          :notification="notification"
        />

        <div v-if="!loading && notifications.length === 0" class="p-8 text-center text-gray-500 dark:text-gray-400">
          <p class="text-lg font-medium">{{ t('notifications.empty') }}</p>
          <p class="text-sm mt-1">{{ t('notifications.empty_hint') }}</p>
        </div>
      </InfiniteScroll>
    </div>
  </AppShell>
</template>
