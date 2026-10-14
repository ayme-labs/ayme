<script setup lang="ts">
const base = `${import.meta.env.BASE_URL}bench/`;
</script>

<!-- Lists the bench pages, for a person opening `/bench/`. -->
<template>
  <main class="mx-auto max-w-md p-8">
    <h1 class="text-2xl font-semibold">Bench pages</h1>
    <ul class="mt-4 list-disc pl-6">
      <li><a :href="`${base}login`">Sign in</a></li>
      <li><a :href="`${base}profile`">Profile</a></li>
      <li><a :href="`${base}settings`">Settings</a></li>
      <li><a :href="`${base}projects`">Projects</a></li>
      <li><a :href="`${base}new-project`">New project</a></li>
    </ul>
  </main>
</template>
