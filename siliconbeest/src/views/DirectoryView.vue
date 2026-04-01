<script setup lang="ts">
import { ref, onMounted, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { apiClient } from '../api/client';

const { t } = useI18n();

const accounts = ref<any[]>([]);
const loading = ref(true);
const order = ref<'active' | 'new'>('active');
const localOnly = ref(true);

async function loadDirectory() {
  loading.value = true;
  try {
    const res = await apiClient.get('/api/v1/directory', {
      params: { order: order.value, local: localOnly.value, limit: 40 },
    });
    accounts.value = res.data;
  } catch (e) {
    console.error('Failed to load directory:', e);
  } finally {
    loading.value = false;
  }
}

watch([order, localOnly], loadDirectory);
onMounted(loadDirectory);
</script>

<template>
  <div class="max-w-2xl mx-auto px-4 py-6">
    <h1 class="text-2xl font-bold mb-2 text-gray-900 dark:text-gray-100">
      {{ t('discovery.directory') }}
    </h1>
    <p class="text-gray-500 dark:text-gray-400 mb-6">
      {{ t('discovery.directory_description') }}
    </p>

    <div class="flex gap-4 mb-6">
      <select
        v-model="order"
        class="rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3 py-2 text-sm"
      >
        <option value="active">{{ t('discovery.directory_order_active') }}</option>
        <option value="new">{{ t('discovery.directory_order_new') }}</option>
      </select>
      <label class="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
        <input
          v-model="localOnly"
          type="checkbox"
          class="rounded border-gray-300 dark:border-gray-600"
        />
        {{ t('discovery.directory_local_only') }}
      </label>
    </div>

    <div v-if="loading" class="text-center py-8 text-gray-500">
      {{ t('common.loading') }}
    </div>

    <div v-else class="space-y-4">
      <router-link
        v-for="account in accounts"
        :key="account.id"
        :to="`/@${account.acct}`"
        class="flex items-center gap-4 p-4 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-indigo-300 dark:hover:border-indigo-600 transition-colors"
      >
        <img
          :src="account.avatar"
          :alt="account.display_name || account.username"
          class="w-12 h-12 rounded-full object-cover"
        />
        <div class="flex-1 min-w-0">
          <div class="font-medium text-gray-900 dark:text-gray-100 truncate">
            {{ account.display_name || account.username }}
          </div>
          <div class="text-sm text-gray-500 dark:text-gray-400 truncate">
            @{{ account.acct }}
          </div>
        </div>
      </router-link>
    </div>
  </div>
</template>
