<script setup lang="ts">
import { onMounted } from 'vue';
import { RouterView, useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { useInstanceStore } from '@/stores/instance';
import { useUiStore } from '@/stores/ui';
import { useComposeStore } from '@/stores/compose';
import { useTimelinesStore } from '@/stores/timelines';
import Modal from '@/components/common/Modal.vue';
import StatusComposer from '@/components/status/StatusComposer.vue';

const auth = useAuthStore();
const instance = useInstanceStore();
const ui = useUiStore();
const compose = useComposeStore();
const timelinesStore = useTimelinesStore();
const router = useRouter();

async function handleGlobalCompose(payload: { content: string; visibility?: string; spoiler_text?: string; language?: string }) {
  if (!auth.token) return;
  compose.text = payload.content;
  if (payload.visibility) compose.visibility = payload.visibility as any;
  if (payload.spoiler_text) {
    compose.contentWarning = payload.spoiler_text;
    compose.showContentWarning = true;
  }
  if (payload.language) compose.language = payload.language;
  const status = await compose.publish();
  if (status) {
    timelinesStore.prependStatus('home', status.id);
    ui.closeComposeModal();
  }
}

onMounted(async () => {
  // Load instance info and verify credentials in parallel
  const promises: Promise<void>[] = [instance.init()];
  if (auth.isAuthenticated) {
    promises.push(auth.fetchCurrentUser());
  }
  await Promise.allSettled(promises);

  // Set dynamic page title
  document.title = instance.instance?.title || 'SiliconBeest';

  // Set dynamic favicon
  const faviconUrl = instance.instance?.thumbnail?.url;
  if (faviconUrl) {
    let link = document.querySelector("link[rel='icon']") as HTMLLinkElement;
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    link.href = faviconUrl;
  }
});
</script>

<template>
  <RouterView />

  <!-- Global compose modal -->
  <Modal :open="ui.composeModalOpen" :title="$t('compose.title')" @close="ui.closeComposeModal()">
    <StatusComposer @submit="handleGlobalCompose" />
  </Modal>
</template>
