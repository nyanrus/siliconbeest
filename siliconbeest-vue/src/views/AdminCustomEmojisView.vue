<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth'
import { apiFetch, apiFetchFormData } from '@/api/client'
import LoadingSpinner from '@/components/common/LoadingSpinner.vue'
import AdminLayout from '@/components/layout/AdminLayout.vue'

interface CustomEmoji {
  id: string
  shortcode: string
  url: string
  static_url: string
  visible_in_picker: boolean
  category: string | null
  created_at: string
  updated_at: string
}

const { t } = useI18n()
const authStore = useAuthStore()

const loading = ref(false)
const error = ref<string | null>(null)
const emojis = ref<CustomEmoji[]>([])

// Upload form state
const showForm = ref(false)
const formShortcode = ref('')
const formCategory = ref('')
const formFile = ref<File | null>(null)
const formSaving = ref(false)

onMounted(() => {
  loadEmojis()
})

async function loadEmojis() {
  loading.value = true
  error.value = null
  try {
    const { data } = await apiFetch<CustomEmoji[]>('/v1/admin/custom_emojis', {
      token: authStore.token ?? undefined,
    })
    emojis.value = data
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
}

function openUploadForm() {
  formShortcode.value = ''
  formCategory.value = ''
  formFile.value = null
  showForm.value = true
}

function cancelForm() {
  showForm.value = false
}

function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  formFile.value = input.files?.[0] ?? null
}

async function uploadEmoji() {
  if (!formShortcode.value.trim() || !formFile.value) return

  formSaving.value = true
  error.value = null

  try {
    const fd = new FormData()
    fd.append('shortcode', formShortcode.value.trim())
    fd.append('image', formFile.value)
    if (formCategory.value.trim()) {
      fd.append('category', formCategory.value.trim())
    }

    await apiFetchFormData('/v1/admin/custom_emojis', fd, {
      token: authStore.token ?? undefined,
    })

    showForm.value = false
    await loadEmojis()
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    formSaving.value = false
  }
}

async function deleteEmoji(id: string) {
  if (!confirm(t('admin.deleteEmojiConfirm'))) return

  try {
    await apiFetch(`/v1/admin/custom_emojis/${id}`, {
      method: 'DELETE',
      token: authStore.token ?? undefined,
    })
    await loadEmojis()
  } catch (e) {
    error.value = (e as Error).message
  }
}
</script>

<template>
  <AdminLayout>
  <div class="w-full">
    <div class="flex items-center justify-between mb-6">
      <h1 class="text-2xl font-bold text-gray-900 dark:text-white">{{ t('admin.customEmojis') }}</h1>
      <button
        v-if="!showForm"
        class="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition-colors"
        @click="openUploadForm"
      >
        {{ t('admin.addEmoji') }}
      </button>
    </div>

    <!-- Error -->
    <div v-if="error" class="mb-4 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
      {{ error }}
    </div>

    <!-- Upload Form -->
    <div v-if="showForm" class="mb-6 p-4 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 space-y-4">
      <h3 class="text-lg font-medium text-gray-900 dark:text-white">
        {{ t('admin.addEmoji') }}
      </h3>

      <div>
        <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          {{ t('admin.emojiShortcode') }}
        </label>
        <input
          v-model="formShortcode"
          type="text"
          placeholder="custom_emoji"
          class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">{{ t('admin.emojiShortcodeHint') }}</p>
      </div>

      <div>
        <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          {{ t('admin.emojiImage') }}
        </label>
        <input
          type="file"
          accept="image/png,image/gif,image/webp"
          class="w-full text-sm text-gray-500 dark:text-gray-400
            file:mr-4 file:py-2 file:px-4
            file:rounded-lg file:border-0
            file:text-sm file:font-medium
            file:bg-indigo-50 file:text-indigo-700
            dark:file:bg-indigo-900/30 dark:file:text-indigo-400
            hover:file:bg-indigo-100 dark:hover:file:bg-indigo-900/50"
          @change="onFileChange"
        />
      </div>

      <div>
        <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          {{ t('admin.emojiCategory') }}
        </label>
        <input
          v-model="formCategory"
          type="text"
          :placeholder="t('admin.emojiCategoryPlaceholder')"
          class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>

      <div class="flex gap-2">
        <button
          :disabled="formSaving || !formShortcode.trim() || !formFile"
          class="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          @click="uploadEmoji"
        >
          {{ formSaving ? t('common.uploading') : t('common.upload') }}
        </button>
        <button
          class="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-sm hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          @click="cancelForm"
        >
          {{ t('common.cancel') }}
        </button>
      </div>
    </div>

    <LoadingSpinner v-if="loading" />

    <div v-else-if="emojis.length === 0 && !showForm" class="text-center py-12 text-gray-500 dark:text-gray-400">
      <p>{{ t('admin.noEmojis') }}</p>
    </div>

    <div v-else class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      <div
        v-for="emoji in emojis"
        :key="emoji.id"
        class="p-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 flex items-center gap-3"
      >
        <img
          :src="emoji.url"
          :alt="emoji.shortcode"
          class="w-10 h-10 object-contain flex-shrink-0"
        />
        <div class="flex-1 min-w-0">
          <p class="text-sm font-medium text-gray-900 dark:text-white truncate">
            :{{ emoji.shortcode }}:
          </p>
          <p v-if="emoji.category" class="text-xs text-gray-500 dark:text-gray-400 truncate">
            {{ emoji.category }}
          </p>
          <p v-if="!emoji.visible_in_picker" class="text-xs text-amber-500">
            {{ t('admin.emojiHidden') }}
          </p>
        </div>
        <button
          class="p-1.5 text-gray-400 hover:text-red-500 dark:hover:text-red-400 flex-shrink-0"
          @click="deleteEmoji(emoji.id)"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
          </svg>
        </button>
      </div>
    </div>
  </div>
  </AdminLayout>
</template>
