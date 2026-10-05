<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useTemplateRef } from "vue";
import { Check, Plug } from "@lucide/vue";
import { ConfigProvider } from "reka-ui";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Stepper,
  StepperIndicator,
  StepperItem,
  StepperSeparator,
  StepperTitle,
  StepperTrigger,
} from "@/components/ui/stepper";
import { setupPrompt } from "./agentPrompts";
import PromptBlock from "./PromptBlock.vue";

const prompt = setupPrompt(window.location.origin + window.location.pathname);

const steps = [
  { step: 1, label: "Set up", title: "Set up your agent" },
  { step: 2, label: "Connect", title: "Connect this page" },
] as const;

const open = ref(false);
const step = ref(1);
const currentStep = computed(
  () => steps.find((candidate) => candidate.step === step.value) ?? steps[0]
);

// The wizard belongs to the site chrome, not to the playground, so its dialog
// is teleported inside this component instead of to <body>. See App.vue.
const wizardHost = useTemplateRef<HTMLElement>("wizardHost");

// An open dialog blocks the page for the agent, so a connect link pasted into
// this tab closes it. Ayme's page client pairs from the same `#ayme=` hash.
function onHashChange(event: HashChangeEvent) {
  if (new URL(event.newURL).hash.startsWith("#ayme=")) open.value = false;
}

onMounted(() => window.addEventListener("hashchange", onHashChange));
onBeforeUnmount(() => window.removeEventListener("hashchange", onHashChange));
</script>

<template>
  <div>
    <Button
      variant="outline"
      data-action="open-agent-wizard"
      type="button"
      @click="open = true"
    >
      <Plug />
      Try with your own coding agent
    </Button>

    <div ref="wizardHost" />

    <ConfigProvider :teleport-to="wizardHost ?? undefined">
      <Dialog v-model:open="open">
        <!--
          Wide enough that the setup prompt's longest line fits without
          wrapping or a horizontal scrollbar on the hosted origin.
        -->
        <DialogContent class="max-h-[90svh] gap-6 overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{{ currentStep.title }}</DialogTitle>
            <DialogDescription>
              Connect this page to a coding agent running on your computer.
            </DialogDescription>
          </DialogHeader>

          <Stepper v-model="step" class="w-full items-start gap-1">
            <StepperItem
              v-for="item in steps"
              :key="item.step"
              :step="item.step"
              class="relative w-full flex-col"
            >
              <StepperSeparator
                v-if="item.step !== steps.length"
                class="absolute top-5 right-[calc(-50%+1rem)] left-[calc(50%+1rem)] h-0.5 shrink-0 rounded-full"
              />
              <StepperTrigger class="gap-2">
                <StepperIndicator
                  class="border bg-background group-data-[state=completed]:border-primary group-data-[state=completed]:bg-primary group-data-[state=completed]:text-primary-foreground"
                >
                  <Check v-if="item.step < step" class="size-4" />
                  <span v-else class="text-sm">{{ item.step }}</span>
                </StepperIndicator>
                <StepperTitle
                  class="text-xs font-medium text-muted-foreground group-data-[state=active]:text-foreground"
                >
                  {{ item.label }}
                </StepperTitle>
              </StepperTrigger>
            </StepperItem>
          </Stepper>

          <!-- 1. Set up your agent -->
          <div v-if="step === 1" class="grid gap-3 text-sm">
            <p>
              Your agent (Claude Code, Codex, …) can’t see browser tabs. Ayme’s
              MCP server is a small program your agent starts on your computer.
              It passes messages between your agent and the one tab you connect.
            </p>
            <p>
              Paste this prompt to your agent to add it. If the agent needs a
              restart to load the server, restart it and paste the prompt again.
            </p>
            <PromptBlock name="prompt" :text="prompt" />
          </div>

          <!-- 2. Connect this page -->
          <div v-else class="grid gap-3 text-sm">
            <p>
              Your agent answers with a link to this page. Paste it into this
              tab’s address bar: only the part after <code>#</code> changes, so
              the page does not reload, and this dialog closes so the agent can
              use the page.
            </p>
            <p class="text-muted-foreground">
              The server runs on your computer, so
              <a
                class="underline underline-offset-4"
                href="https://developer.chrome.com/blog/local-network-access"
                target="_blank"
                rel="noreferrer"
                >Chrome asks</a
              >
              whether this site may reach it. Allow it to connect.
            </p>
          </div>

          <DialogFooter>
            <Button
              v-if="step === 2"
              variant="outline"
              data-action="wizard-back"
              type="button"
              @click="step = 1"
            >
              Back
            </Button>
            <Button
              v-if="step === 1"
              data-action="wizard-next"
              type="button"
              @click="step = 2"
            >
              Next
            </Button>
            <Button
              v-else
              data-action="wizard-done"
              type="button"
              @click="open = false"
            >
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ConfigProvider>
  </div>
</template>
