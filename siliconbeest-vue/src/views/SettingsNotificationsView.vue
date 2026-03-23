<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth'
import LoadingSpinner from '@/components/common/LoadingSpinner.vue'

const { t } = useI18n()
const authStore = useAuthStore()

const PREFS_KEY = 'siliconbeest_notification_prefs'

const loading = ref(false)
const saving = ref(false)
const error = ref<string | null>(null)
const success = ref(false)

const notificationTypes = ref([
  { key: 'follow', enabled: true },
  { key: 'favourite', enabled: true },
  { key: 'reblog', enabled: true },
  { key: 'mention', enabled: true },
  { key: 'poll', enabled: true },
])

onMounted(() => {
  loadPreferences()
})

function loadPreferences() {
  loading.value = true
  try {
    const stored = localStorage.getItem(PREFS_KEY)
    if (stored) {
      const parsed = JSON.parse(stored) as Record<string, boolean>
      notificationTypes.value.forEach((nt) => {
        if (parsed[nt.key] !== undefined) {
          nt.enabled = parsed[nt.key]
        }
      })
    }
  } catch {
    // Use defaults
  } finally {
    loading.value = false
  }
}

function savePreferences() {
  saving.value = true
  error.value = null
  success.value = false

  try {
    const prefs: Record<string, boolean> = {}
    notificationTypes.value.forEach((nt) => {
      prefs[nt.key] = nt.enabled
    })
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
    success.value = true
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    saving.value = false
  }
}

function toggleNotification(key: string) {
  const nt = notificationTypes.value.find((n) => n.key === key)
  if (nt) {
    nt.enabled = !nt.enabled
  }
}
</script>

<template>
  <div class="w-full">
    <h2 class="text-xl font-bold mb-6 text-gray-900 dark:text-white">{{ t('settings.notifications') }}</h2>

    <LoadingSpinner v-if="loading" />

    <div v-else class="space-y-6">
      <div class="space-y-1">
        <div
          v-for="nt in notificationTypes"
          :key="nt.key"
          class="flex items-center justify-between py-3 border-b border-gray-100 dark:border-gray-800 last:border-0"
        >
          <div>
            <p class="text-sm font-medium text-gray-900 dark:text-white">
              {{ t(`settings.notif_${nt.key}`) }}
            </p>
            <p class="text-xs text-gray-500 dark:text-gray-400">
              {{ t(`settings.notif_${nt.key}_desc`) }}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            :aria-checked="nt.enabled"
            class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 dark:focus:ring-offset-gray-900"
            :class="nt.enabled ? 'bg-indigo-600' : 'bg-gray-300 dark:bg-gray-600'"
            @click="toggleNotification(nt.key)"
          >
            <span
              class="inline-block h-4 w-4 transform rounded-full bg-white transition-transform"
              :class="nt.enabled ? 'translate-x-6' : 'translate-x-1'"
            />
          </button>
        </div>
      </div>

      <!-- Error / Success -->
      <div v-if="error" class="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
        {{ error }}
      </div>
      <div v-if="success" class="p-3 rounded-lg bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 text-sm">
        {{ t('settings.saved') }}
      </div>

      <button
        :disabled="saving"
        class="w-full px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        @click="savePreferences"
      >
        {{ saving ? t('common.loading') : t('common.save') }}
      </button>
    </div>
  </div>
</template>
