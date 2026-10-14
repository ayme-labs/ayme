<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";

type Profile = {
  firstName: string;
  lastName: string;
  displayName: string;
  email: string;
  bio: string;
};

const saved = reactive<Profile>({
  firstName: "Ada",
  lastName: "Lovelace",
  displayName: "ada",
  email: "ada@example.com",
  bio: "Writes about engines.",
});
const form = reactive<Profile>({ ...saved });
const savedMessage = ref("");
const editor = ref<HTMLElement>();

// The editor owns its content, as a rich-text editor does; the form reads it
// back on every input.
onMounted(() => {
  editor.value!.textContent = form.bio;
});

function readBio(event: Event) {
  form.bio = (event.target as HTMLElement).innerText.trim();
}

function format(command: "bold" | "italic") {
  editor.value?.focus();
  document.execCommand(command);
}

function save() {
  Object.assign(saved, form);
  savedMessage.value = "Profile saved";
}
</script>

<template>
  <main class="mx-auto grid max-w-2xl gap-8 p-8">
    <h1 class="text-2xl font-semibold">Profile</h1>
    <form aria-label="Edit profile" class="grid gap-3" @submit.prevent="save">
      <label for="profile-first-name" class="text-sm font-medium">
        First name
      </label>
      <input
        id="profile-first-name"
        v-model="form.firstName"
        class="rounded border px-2 py-1"
      />
      <label for="profile-last-name" class="text-sm font-medium">
        Last name
      </label>
      <input
        id="profile-last-name"
        v-model="form.lastName"
        class="rounded border px-2 py-1"
      />
      <label for="profile-display-name" class="text-sm font-medium">
        Display name
      </label>
      <input
        id="profile-display-name"
        v-model="form.displayName"
        class="rounded border px-2 py-1"
      />
      <label for="profile-email" class="text-sm font-medium">Email</label>
      <input
        id="profile-email"
        v-model="form.email"
        type="email"
        class="rounded border px-2 py-1"
      />
      <!--
        A rich-text editor as editor libraries such as Lexical render one: a
        toolbar and a contenteditable textbox, with a caption that is not its
        label, so the editor has no accessible name.
      -->
      <span class="text-sm font-medium">Bio</span>
      <div class="rounded border">
        <div class="flex gap-1 border-b p-1">
          <button
            type="button"
            aria-label="Bold"
            class="px-2 font-bold"
            @click="format('bold')"
          >
            B
          </button>
          <button
            type="button"
            aria-label="Italic"
            class="px-2 italic"
            @click="format('italic')"
          >
            I
          </button>
        </div>
        <div
          ref="editor"
          contenteditable="true"
          role="textbox"
          aria-multiline="true"
          class="min-h-20 p-2"
          data-testid="bio-editor"
          @input="readBio"
        ></div>
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
      aria-labelledby="public-profile-heading"
      class="rounded border p-4"
    >
      <h2 id="public-profile-heading" class="font-semibold">Public profile</h2>
      <p class="mt-2">
        <span data-testid="saved-first-name">{{ saved.firstName }}</span>
        {{ " " }}
        <span data-testid="saved-last-name">{{ saved.lastName }}</span>
        (@<span data-testid="saved-display-name">{{ saved.displayName }}</span
        >)
      </p>
      <p data-testid="saved-email">{{ saved.email }}</p>
      <p data-testid="saved-bio">{{ saved.bio }}</p>
    </section>
  </main>
</template>
