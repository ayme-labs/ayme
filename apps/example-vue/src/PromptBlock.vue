<script setup lang="ts">
import { ref } from "vue";
import { Check, Copy } from "@lucide/vue";
import { Button } from "@/components/ui/button";

// A prompt the visitor reads in full before copying it to their agent.
const props = defineProps<{ name: string; text: string }>();

const copyState = ref<"idle" | "copied" | "blocked">("idle");

async function copy() {
  try {
    await navigator.clipboard.writeText(props.text);
    copyState.value = "copied";
  } catch {
    copyState.value = "blocked";
  }
}
</script>

<template>
  <div class="relative rounded-md border bg-muted/50">
    <pre
      :data-prompt="name"
      class="max-h-[40svh] overflow-auto p-3 pb-12 font-mono text-xs leading-relaxed whitespace-pre-wrap"
      >{{ text }}</pre>
    <div class="absolute right-2 bottom-2 flex items-center gap-2">
      <span
        v-if="copyState === 'blocked'"
        class="text-xs text-muted-foreground"
        role="status"
      >
        Copying is blocked — select the text
      </span>
      <Button
        variant="outline"
        size="icon"
        type="button"
        :data-action="`copy-${name}`"
        :aria-label="copyState === 'copied' ? 'Copied' : 'Copy prompt'"
        @click="copy"
      >
        <Check v-if="copyState === 'copied'" />
        <Copy v-else />
      </Button>
    </div>
  </div>
</template>
