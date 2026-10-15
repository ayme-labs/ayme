<script setup lang="ts">
import { reactive, ref } from "vue";

type Settings = {
  emailNotifications: boolean;
  pushNotifications: boolean;
  weeklySummaryEmail: boolean;
  theme: "Light" | "Dark" | "System";
  language: string;
};

const themes = ["Light", "Dark", "System"] as const;
const languages = ["English", "Deutsch", "Français", "Español"];

const saved = reactive<Settings>({
  emailNotifications: true,
  pushNotifications: false,
  weeklySummaryEmail: false,
  theme: "System",
  language: "English",
});
const form = reactive<Settings>({ ...saved });
const savedMessage = ref("");

const onOff = (value: boolean) => (value ? "On" : "Off");

function save() {
  Object.assign(saved, form);
  savedMessage.value = "Settings saved";
}
</script>

<template>
  <main class="mx-auto grid max-w-2xl gap-8 p-8">
    <h1 class="text-2xl font-semibold">Settings</h1>
    <form aria-label="Settings" class="grid gap-6" @submit.prevent="save">
      <fieldset class="grid gap-2">
        <legend class="font-medium">Notifications</legend>
        <label class="flex items-center gap-2">
          <input v-model="form.emailNotifications" type="checkbox" />
          Email notifications
        </label>
        <label class="flex items-center gap-2">
          <input v-model="form.pushNotifications" type="checkbox" />
          Push notifications
        </label>
        <label class="flex items-center gap-2">
          <input v-model="form.weeklySummaryEmail" type="checkbox" />
          Weekly summary email
        </label>
      </fieldset>
      <fieldset class="grid gap-2">
        <legend class="font-medium">Theme</legend>
        <label
          v-for="theme in themes"
          :key="theme"
          class="flex items-center gap-2"
        >
          <input
            v-model="form.theme"
            type="radio"
            name="theme"
            :value="theme"
          />
          {{ theme }}
        </label>
      </fieldset>
      <div class="grid gap-2">
        <label for="settings-language" class="font-medium">Language</label>
        <select
          id="settings-language"
          v-model="form.language"
          class="rounded border px-2 py-1"
        >
          <option v-for="language in languages" :key="language">
            {{ language }}
          </option>
        </select>
      </div>
      <div class="flex items-center gap-3">
        <button
          type="submit"
          class="rounded bg-primary px-3 py-1 text-primary-foreground"
        >
          Save
        </button>
        <p v-if="savedMessage" role="status" class="text-sm">
          {{ savedMessage }}
        </p>
      </div>
    </form>
    <section
      aria-labelledby="saved-settings-heading"
      class="rounded border p-4"
    >
      <h2 id="saved-settings-heading" class="font-semibold">Saved settings</h2>
      <ul class="mt-2 text-sm">
        <li data-testid="saved-email-notifications">
          Email notifications: {{ onOff(saved.emailNotifications) }}
        </li>
        <li data-testid="saved-push-notifications">
          Push notifications: {{ onOff(saved.pushNotifications) }}
        </li>
        <li data-testid="saved-weekly-summary-email">
          Weekly summary email: {{ onOff(saved.weeklySummaryEmail) }}
        </li>
        <li data-testid="saved-theme">Theme: {{ saved.theme }}</li>
        <li data-testid="saved-language">Language: {{ saved.language }}</li>
      </ul>
    </section>
  </main>
</template>
