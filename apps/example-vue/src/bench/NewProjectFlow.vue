<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { benchPath, navigate } from "./benchRouter";

/**
 * Two screens of one flow, at two paths: the details form's Continue moves
 * to the invite form with a client-side route change, and the invite form's
 * Create project finishes the flow.
 */
const visibilities = ["Private", "Internal", "Public"];
const roles = ["Viewer", "Editor", "Admin"];

const details = reactive({
  name: "",
  description: "",
  visibility: "Private",
});
const invite = reactive({ email: "", role: "Viewer" });
const error = ref("");
const created = ref<{
  name: string;
  description: string;
  visibility: string;
  email: string;
  role: string;
}>();

const screen = computed(() =>
  benchPath.value === "bench/new-project/invite" ? "invite" : "details"
);

function next() {
  if (!details.name.trim()) {
    error.value = "Enter a project name.";
    return;
  }
  error.value = "";
  navigate("bench/new-project/invite");
}

function create() {
  if (!invite.email.trim()) {
    error.value = "Enter an email to invite.";
    return;
  }
  error.value = "";
  created.value = {
    name: details.name.trim(),
    description: details.description.trim(),
    visibility: details.visibility,
    email: invite.email.trim(),
    role: invite.role,
  };
}
</script>

<template>
  <main class="mx-auto grid max-w-md gap-4 p-8">
    <template v-if="screen === 'details'">
      <h1 class="text-2xl font-semibold">New project</h1>
      <p class="text-sm text-muted-foreground">Step 1 of 2: project details</p>
      <form
        aria-label="Project details"
        class="grid gap-3"
        @submit.prevent="next"
      >
        <label for="project-name" class="text-sm font-medium">
          Project name
        </label>
        <input
          id="project-name"
          v-model="details.name"
          class="rounded border px-2 py-1"
        />
        <label for="project-description" class="text-sm font-medium">
          Description
        </label>
        <textarea
          id="project-description"
          v-model="details.description"
          class="rounded border px-2 py-1"
        ></textarea>
        <label for="project-visibility" class="text-sm font-medium">
          Visibility
        </label>
        <select
          id="project-visibility"
          v-model="details.visibility"
          class="rounded border px-2 py-1"
        >
          <option v-for="visibility in visibilities" :key="visibility">
            {{ visibility }}
          </option>
        </select>
        <p v-if="error" role="alert" class="text-sm text-destructive">
          {{ error }}
        </p>
        <button
          type="submit"
          class="rounded bg-primary px-3 py-1 text-primary-foreground"
        >
          Continue
        </button>
      </form>
    </template>

    <template v-else-if="!details.name">
      <h1 class="text-2xl font-semibold">Invite teammates</h1>
      <p>
        Start with the project details.
        <a href="#" @click.prevent="navigate('bench/new-project')">
          Back to project details
        </a>
      </p>
    </template>

    <template v-else-if="created">
      <h1 class="text-2xl font-semibold">Project created</h1>
      <p role="status">
        Project
        <span data-testid="created-name">{{ created.name }}</span> created
        (<span data-testid="created-visibility">{{ created.visibility }}</span
        >). Invited
        <span data-testid="created-email">{{ created.email }}</span> as
        <span data-testid="created-role">{{ created.role }}</span
        >.
      </p>
      <p data-testid="created-description">{{ created.description }}</p>
    </template>

    <template v-else>
      <h1 class="text-2xl font-semibold">Invite teammates</h1>
      <p class="text-sm text-muted-foreground">
        Step 2 of 2: invite people to {{ details.name }}
      </p>
      <form
        aria-label="Invite teammates"
        class="grid gap-3"
        @submit.prevent="create"
      >
        <label for="invite-email" class="text-sm font-medium">Email</label>
        <input
          id="invite-email"
          v-model="invite.email"
          type="email"
          class="rounded border px-2 py-1"
        />
        <label for="invite-role" class="text-sm font-medium">Role</label>
        <select
          id="invite-role"
          v-model="invite.role"
          class="rounded border px-2 py-1"
        >
          <option v-for="role in roles" :key="role">{{ role }}</option>
        </select>
        <p v-if="error" role="alert" class="text-sm text-destructive">
          {{ error }}
        </p>
        <div class="flex justify-between gap-2">
          <button
            type="button"
            class="rounded border px-3 py-1"
            @click="navigate('bench/new-project')"
          >
            Back
          </button>
          <button
            type="submit"
            class="rounded bg-primary px-3 py-1 text-primary-foreground"
          >
            Create project
          </button>
        </div>
      </form>
    </template>
  </main>
</template>
