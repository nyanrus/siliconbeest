<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useUiStore, type Theme } from '@/stores/ui'
import { useAuthStore } from '@/stores/auth'
import { updateCredentials } from '@/api/mastodon/accounts'
import LanguageSelector from '@/components/settings/LanguageSelector.vue'
import { SUPPORTED_LOCALES } from '@/i18n'

const { t } = useI18n()
const uiStore = useUiStore()
const auth = useAuthStore()

const themes: { value: Theme; labelKey: string }[] = [
  { value: 'light', labelKey: 'settings.themeLight' },
  { value: 'dark', labelKey: 'settings.themeDark' },
  { value: 'system', labelKey: 'settings.themeSystem' },
]

const defaultLanguage = ref(auth.currentUser?.source?.language || 'en')
const savingDefaultLang = ref(false)
const defaultLangSuccess = ref(false)

const localeMap = Object.fromEntries(SUPPORTED_LOCALES.map((l) => [l.code, l.name]))

function selectTheme(theme: Theme) {
  uiStore.setTheme(theme)
}

async function saveDefaultLanguage(newLocale: string) {
  defaultLanguage.value = newLocale
  savingDefaultLang.value = true
  defaultLangSuccess.value = false
  try {
    const formData = new FormData()
    formData.append('source[language]', newLocale)
    await updateCredentials(auth.token!, formData)
    await auth.fetchCurrentUser()
    defaultLangSuccess.value = true
    setTimeout(() => { defaultLangSuccess.value = false }, 2000)
  } catch {
    // Revert on failure
    defaultLanguage.value = auth.currentUser?.source?.language || 'en'
  } finally {
    savingDefaultLang.value = false
  }
}

onMounted(() => {
  if (auth.currentUser?.source?.language) {
    defaultLanguage.value = auth.currentUser.source.language
  }
})
</script>

<template>
  <div class="w-full">
    <h2 class="text-xl font-bold mb-6 text-gray-900 dark:text-white">{{ t('settings.appearance') }}</h2>

    <div class="space-y-8">
      <!-- Theme -->
      <div>
        <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
          {{ t('settings.theme') }}
        </label>
        <div class="grid grid-cols-3 gap-3">
          <button
            v-for="theme in themes"
            :key="theme.value"
            class="px-4 py-3 rounded-lg border-2 text-sm font-medium transition-colors"
            :class="
              uiStore.theme === theme.value
                ? 'border-indigo-600 bg-indigo-50 text-indigo-700 dark:border-indigo-400 dark:bg-indigo-900/20 dark:text-indigo-300'
                : 'border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600'
            "
            @click="selectTheme(theme.value)"
          >
            {{ t(theme.labelKey) }}
          </button>
        </div>
      </div>

      <!-- Display Language (client-side, localStorage) -->
      <div>
        <h3 class="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{{ t('settings.display_language') }}</h3>
        <p class="text-xs text-gray-500 dark:text-gray-400 mb-2">{{ t('settings.display_language_desc') }}</p>
        <LanguageSelector />
      </div>

      <!-- Default Language (server-side, users.locale) -->
      <div>
        <h3 class="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{{ t('settings.default_language') }}</h3>
        <p class="text-xs text-gray-500 dark:text-gray-400 mb-2">{{ t('settings.default_language_desc') }}</p>
        <div class="flex items-center gap-3">
          <select
            :value="defaultLanguage"
            @change="saveDefaultLanguage(($event.target as HTMLSelectElement).value)"
            :disabled="savingDefaultLang"
            class="w-full max-w-xs px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
          >
            <option v-for="loc in SUPPORTED_LOCALES" :key="loc.code" :value="loc.code">
              {{ loc.name }}
            </option>
          </select>
          <span v-if="defaultLangSuccess" class="text-sm text-green-600 dark:text-green-400">{{ t('settings.saved') }}</span>
        </div>
      </div>
    </div>
  </div>
</template>
