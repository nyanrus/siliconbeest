<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { apiClient } from '../api/client';

const { t } = useI18n();

interface FollowedTag {
  name: string;
  url: string;
  following: boolean;
}

const tags = ref<FollowedTag[]>([]);
const loading = ref(true);

async function loadTags() {
  loading.value = true;
  try {
    const res = await apiClient.get('/api/v1/followed_tags');
    tags.value = res.data;
  } catch (e) {
    console.error('Failed to load followed tags:', e);
  } finally {
    loading.value = false;
  }
}

async function unfollowTag(tagName: string) {
  try {
    await apiClient.post(`/api/v1/tags/${tagName}/unfollow`);
    tags.value = tags.value.filter((t) => t.name !== tagName);
  } catch (e) {
    console.error('Failed to unfollow tag:', e);
  }
}

onMounted(loadTags);
</script>

<template>
  <div class="max-w-2xl mx-auto px-4 py-6">
    <h1 class="text-2xl font-bold mb-6 text-gray-900 dark:text-gray-100">
      {{ t('discovery.followed_tags') }}
    </h1>

    <div v-if="loading" class="text-center py-8 text-gray-500">
      {{ t('common.loading') }}
    </div>

    <div v-else-if="tags.length === 0" class="text-center py-8 text-gray-500 dark:text-gray-400">
      {{ t('discovery.followed_tags_empty') }}
    </div>

    <ul v-else class="space-y-3">
      <li
        v-for="tag in tags"
        :key="tag.name"
        class="flex items-center justify-between p-4 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700"
      >
        <router-link
          :to="`/tags/${tag.name}`"
          class="text-lg font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
        >
          #{{ tag.name }}
        </router-link>
        <button
          class="px-3 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          @click="unfollowTag(tag.name)"
        >
          {{ t('discovery.unfollow_tag') }}
        </button>
      </li>
    </ul>
  </div>
</template>
