<script setup lang="ts">
import { computed, ref } from "vue";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type ListItem = {
  id: string;
  text: string;
  archived: boolean;
};

const items = ref<ListItem[]>([
  { id: "item-1", text: "Prepare launch notes", archived: false },
  { id: "item-2", text: "Review onboarding flow", archived: false },
]);
const nextItemNumber = ref(3);
const newItemText = ref("");
const inputError = ref("");
const archiveTargetId = ref<string>();
const editingItemId = ref<string>();
const editingItemText = ref("");

const activeItems = computed(() =>
  items.value.filter((item) => !item.archived)
);
const archivedItems = computed(() =>
  items.value.filter((item) => item.archived)
);
const archiveTarget = computed(() =>
  items.value.find((item) => item.id === archiveTargetId.value)
);

function addItem() {
  const text = newItemText.value.trim();
  if (!text) {
    inputError.value = "Enter an item name first.";
    return;
  }

  items.value.push({
    id: `item-${nextItemNumber.value}`,
    text,
    archived: false,
  });
  nextItemNumber.value += 1;
  newItemText.value = "";
  inputError.value = "";
}

function openArchive(itemId: string) {
  const item = items.value.find((candidate) => candidate.id === itemId);
  if (!item || item.archived) return;
  archiveTargetId.value = itemId;
}

function startRenaming(itemId: string) {
  const item = items.value.find((candidate) => candidate.id === itemId);
  if (!item || item.archived) return;
  editingItemId.value = item.id;
  editingItemText.value = item.text;
}

function renameItem(itemId: string) {
  const item = items.value.find((candidate) => candidate.id === itemId);
  const text = editingItemText.value.trim();
  if (!item || !text) return;

  item.text = text;
  editingItemId.value = undefined;
  editingItemText.value = "";
}

function cancelArchive() {
  archiveTargetId.value = undefined;
}

function confirmArchive() {
  const item = archiveTarget.value;
  if (!item) return;

  item.archived = true;
  archiveTargetId.value = undefined;
}
</script>

<template>
  <section aria-label="Demo application">
    <Card>
      <CardHeader>
        <p
          class="text-xs font-semibold tracking-widest text-muted-foreground uppercase"
        >
          Demo application
        </p>
        <CardTitle as="h2" class="text-xl tracking-tight">My list</CardTitle>
        <CardAction>
          <Badge variant="secondary">{{ activeItems.length }} active</Badge>
        </CardAction>
      </CardHeader>

      <CardContent>
        <form aria-label="Add a list item" @submit.prevent="addItem">
          <Label for="new-item">New item</Label>
          <div class="mt-2 flex flex-col gap-2 sm:flex-row">
            <Input
              id="new-item"
              v-model="newItemText"
              autocomplete="off"
              placeholder="e.g. Send the project update"
              class="sm:flex-1"
            />
            <Button type="submit">Add item</Button>
          </div>
          <p
            v-if="inputError"
            class="mt-2 text-sm text-destructive"
            role="alert"
          >
            {{ inputError }}
          </p>
        </form>

        <section class="list-card" aria-labelledby="active-items-heading">
          <div class="section-heading">
            <h3 id="active-items-heading">Active items</h3>
            <span>{{ activeItems.length }}</span>
          </div>
          <ul v-if="activeItems.length" class="item-list">
            <li v-for="item in activeItems" :key="item.id" class="item-row">
              <div>
                <input
                  v-if="editingItemId === item.id"
                  v-model="editingItemText"
                  aria-label="Item name"
                  @blur="renameItem(item.id)"
                  @keyup.enter="renameItem(item.id)"
                />
                <button
                  v-else
                  class="item-name-button"
                  data-action="rename"
                  type="button"
                  @click="startRenaming(item.id)"
                >
                  {{ item.text }}
                </button>
                <code>{{ item.id }}</code>
              </div>
              <button
                data-action="archive"
                type="button"
                :aria-label="`Archive ${item.id}`"
                @click="openArchive(item.id)"
              >
                Archive
              </button>
            </li>
          </ul>
          <p v-else class="empty-state">No active items. Add one above.</p>
        </section>

        <section
          class="list-card archived-card"
          aria-labelledby="archived-items-heading"
        >
          <div class="section-heading">
            <h3 id="archived-items-heading">Archived items</h3>
            <span>{{ archivedItems.length }}</span>
          </div>
          <ul v-if="archivedItems.length" class="item-list">
            <li
              v-for="item in archivedItems"
              :key="item.id"
              class="item-row archived-row"
            >
              <div>
                <strong>{{ item.text }}</strong>
                <code>{{ item.id }}</code>
              </div>
              <span class="archived-label">Archived</span>
            </li>
          </ul>
          <p v-else class="empty-state">Archived items will appear here.</p>
        </section>
      </CardContent>
    </Card>

    <div v-if="archiveTarget" class="dialog-backdrop">
      <div
        class="archive-dialog"
        role="dialog"
        aria-label="Archive item"
        aria-modal="true"
      >
        <p class="eyebrow">Confirmation</p>
        <h3>Archive this item?</h3>
        <p>
          <strong>{{ archiveTarget.text }}</strong> will move to the archived
          list.
        </p>
        <div class="dialog-actions">
          <button type="button" @click="cancelArchive">Cancel</button>
          <button class="primary-button" type="button" @click="confirmArchive">
            Confirm archive
          </button>
        </div>
      </div>
    </div>
  </section>
</template>
