<script setup lang="ts">
import { ref } from "vue";

const email = ref("");
const password = ref("");
const remember = ref(false);
const error = ref("");
const signedInAs = ref("");

/** The one password this page accepts, so a sign-in with another fails. */
const knownPassword = "correct-horse-battery";

function signIn() {
  if (!email.value.trim() || !password.value) {
    error.value = "Enter your email and password.";
    return;
  }
  if (password.value !== knownPassword) {
    error.value = "Wrong password.";
    return;
  }
  error.value = "";
  signedInAs.value = email.value.trim();
}
</script>

<template>
  <main class="mx-auto max-w-sm p-8">
    <h1 class="text-2xl font-semibold">Sign in</h1>
    <p v-if="signedInAs" role="status" class="mt-4">
      Signed in as {{ signedInAs }}
    </p>
    <form
      v-else
      aria-label="Sign in"
      class="mt-4 grid gap-3"
      @submit.prevent="signIn"
    >
      <label for="login-email" class="text-sm font-medium">Email</label>
      <input
        id="login-email"
        v-model="email"
        type="email"
        autocomplete="email"
        class="rounded border px-2 py-1"
      />
      <label for="login-password" class="text-sm font-medium">Password</label>
      <input
        id="login-password"
        v-model="password"
        type="password"
        autocomplete="current-password"
        class="rounded border px-2 py-1"
      />
      <label class="flex items-center gap-2 text-sm">
        <input v-model="remember" type="checkbox" />
        Remember me
      </label>
      <p v-if="error" role="alert" class="text-sm text-destructive">
        {{ error }}
      </p>
      <button
        type="submit"
        class="rounded bg-primary px-3 py-1 text-primary-foreground"
      >
        Sign in
      </button>
      <a href="#forgot-password" class="text-sm underline">Forgot password?</a>
    </form>
  </main>
</template>
