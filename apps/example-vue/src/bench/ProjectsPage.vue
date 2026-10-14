<script setup lang="ts">
import { computed, nextTick, ref } from "vue";

type Project = { id: number; name: string; owner: string };

const projects = ref<Project[]>([
  { id: 1, name: "Website redesign", owner: "Grace" },
  { id: 2, name: "Mobile app", owner: "Alan" },
  { id: 3, name: "Marketing site", owner: "Grace" },
  { id: 4, name: "Mobile analytics", owner: "Barbara" },
  { id: 5, name: "Billing migration", owner: "Alan" },
]);
const search = ref("");
const renaming = ref<Project>();
const newName = ref("");
const nameInput = ref<HTMLInputElement>();
const status = ref("");

const shown = computed(() => {
  const query = search.value.trim().toLowerCase();
  return projects.value.filter((project) =>
    project.name.toLowerCase().includes(query)
  );
});

async function openRename(project: Project) {
  renaming.value = project;
  newName.value = project.name;
  await nextTick();
  nameInput.value?.focus();
}

function cancel() {
  renaming.value = undefined;
}

function confirm() {
  const project = renaming.value;
  const name = newName.value.trim();
  if (!project || !name) return;
  status.value = `Renamed ${project.name} to ${name}`;
  project.name = name;
  renaming.value = undefined;
}
</script>

<template>
  <main class="mx-auto grid max-w-2xl gap-6 p-8">
    <h1 class="text-2xl font-semibold">Projects</h1>
    <div class="grid gap-2">
      <label for="projects-search" class="text-sm font-medium">
        Search projects
      </label>
      <input
        id="projects-search"
        v-model="search"
        type="search"
        class="rounded border px-2 py-1"
      />
    </div>
    <p v-if="status" role="status" class="text-sm">{{ status }}</p>
    <ul aria-label="Projects" class="divide-y rounded border">
      <li
        v-for="project in shown"
        :key="project.id"
        class="flex items-center justify-between gap-3 p-3"
      >
        <div>
          <p class="font-medium" data-testid="project-name">
            {{ project.name }}
          </p>
          <p class="text-sm text-muted-foreground">
            Owner: {{ project.owner }}
          </p>
        </div>
        <button
          type="button"
          class="rounded border px-2 py-1 text-sm"
          @click="openRename(project)"
        >
          Rename
        </button>
      </li>
    </ul>
    <p v-if="shown.length === 0" class="text-sm">No projects match.</p>

    <div
      v-if="renaming"
      class="fixed inset-0 grid place-items-center bg-black/40"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="rename-title"
        class="grid w-80 gap-3 rounded bg-background p-4"
      >
        <h2 id="rename-title" class="font-semibold">Rename project</h2>
        <form class="grid gap-3" @submit.prevent="confirm">
          <label for="rename-name" class="text-sm font-medium">
            Project name
          </label>
          <input
            id="rename-name"
            ref="nameInput"
            v-model="newName"
            class="rounded border px-2 py-1"
          />
          <div class="flex justify-end gap-2">
            <button
              type="button"
              class="rounded border px-3 py-1"
              @click="cancel"
            >
              Cancel
            </button>
            <button
              type="submit"
              class="rounded bg-primary px-3 py-1 text-primary-foreground"
            >
              Confirm
            </button>
          </div>
        </form>
      </div>
    </div>
  </main>
</template>
