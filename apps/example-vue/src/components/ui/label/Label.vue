<script setup lang="ts">
import type { HTMLAttributes } from "vue";
import { Label, type LabelProps } from "reka-ui";
import { cn } from "@/lib/utils";

// Upstream shadcn-vue strips `class` with @vueuse/core's reactiveOmit. The
// props are forwarded explicitly here so the app does not depend on @vueuse.
const props = defineProps<LabelProps & { class?: HTMLAttributes["class"] }>();
</script>

<template>
  <Label
    data-slot="label"
    :for="props.for"
    :as="props.as"
    :as-child="props.asChild"
    :class="
      cn(
        'flex items-center gap-2 text-sm leading-none font-medium select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50',
        props.class
      )
    "
  >
    <slot />
  </Label>
</template>
