<script setup lang="ts">
import type { HTMLAttributes } from "vue";
import { Primitive, type PrimitiveProps } from "reka-ui";
import { cn } from "@/lib/utils";

const props = withDefaults(
  defineProps<PrimitiveProps & { class?: HTMLAttributes["class"] }>(),
  { as: "div" }
);
</script>

<template>
  <Primitive
    data-slot="card-title"
    :as="props.as"
    :as-child="props.asChild"
    :class="cn('leading-none font-semibold', props.class)"
  >
    <slot />
  </Primitive>
</template>
