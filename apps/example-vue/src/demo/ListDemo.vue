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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
// Kept separate from the target so the dialog still reads correctly while it
// animates out, after the target has been cleared.
const archiveTargetText = ref("");
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
const archiveDialogOpen = computed({
  get: () => archiveTarget.value !== undefined,
  set: (open: boolean) => {
    if (!open) archiveTargetId.value = undefined;
  },
});

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
  archiveTargetText.value = item.text;
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
  <section aria-label="Demo application" class="grid gap-6">
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
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle id="active-items-heading" as="h3" class="text-base">
          Active items
        </CardTitle>
        <CardAction>
          <Badge variant="secondary">{{ activeItems.length }}</Badge>
        </CardAction>
      </CardHeader>

      <CardContent>
        <ul
          v-if="activeItems.length"
          aria-labelledby="active-items-heading"
          class="divide-y"
        >
          <li
            v-for="item in activeItems"
            :key="item.id"
            class="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
          >
            <div class="grid min-w-0 flex-1 gap-1">
              <Input
                v-if="editingItemId === item.id"
                v-model="editingItemText"
                aria-label="Item name"
                @blur="renameItem(item.id)"
                @keyup.enter="renameItem(item.id)"
              />
              <Button
                v-else
                variant="link"
                data-action="rename"
                type="button"
                class="h-auto justify-start p-0 font-medium text-foreground"
                @click="startRenaming(item.id)"
              >
                {{ item.text }}
              </Button>
              <code class="text-xs text-muted-foreground">{{ item.id }}</code>
            </div>
            <Button
              variant="outline"
              size="sm"
              data-action="archive"
              type="button"
              :aria-label="`Archive ${item.id}`"
              @click="openArchive(item.id)"
            >
              Archive
            </Button>
          </li>
        </ul>
        <p v-else class="text-sm text-muted-foreground">
          No active items. Add one above.
        </p>
      </CardContent>
    </Card>

    <Card class="bg-muted/40">
      <CardHeader>
        <CardTitle id="archived-items-heading" as="h3" class="text-base">
          Archived items
        </CardTitle>
        <CardAction>
          <Badge variant="secondary">{{ archivedItems.length }}</Badge>
        </CardAction>
      </CardHeader>

      <CardContent>
        <ul
          v-if="archivedItems.length"
          aria-labelledby="archived-items-heading"
          class="divide-y"
        >
          <li
            v-for="item in archivedItems"
            :key="item.id"
            class="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
          >
            <div class="grid min-w-0 flex-1 gap-1">
              <span class="font-medium text-muted-foreground">
                {{ item.text }}
              </span>
              <code class="text-xs text-muted-foreground">{{ item.id }}</code>
            </div>
            <Badge variant="secondary" data-archived-label>Archived</Badge>
          </li>
        </ul>
        <p v-else class="text-sm text-muted-foreground">
          Archived items will appear here.
        </p>
      </CardContent>
    </Card>

    <Dialog v-model:open="archiveDialogOpen">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Archive item</DialogTitle>
          <DialogDescription>
            <strong class="font-medium text-foreground">{{
              archiveTargetText
            }}</strong>
            will move to the archived list.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" type="button" @click="cancelArchive">
            Cancel
          </Button>
          <Button
            data-action="confirm-archive"
            type="button"
            @click="confirmArchive"
          >
            Confirm archive
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </section>
</template>
