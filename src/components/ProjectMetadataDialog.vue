<script setup lang="ts">
import {computed, ref} from 'vue'
import type {ProjectMetadata} from '@/core/accelerator-service'
import {
  PROJECT_DESCRIPTION_MAX_BYTES,
  PROJECT_NAME_MAX_BYTES,
  byteLength,
  metadataErrors,
} from '@/core/accelerator-rules'
import {formatAmount, parseAmount} from '@/core/token-rules'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  Input,
  Textarea,
} from 'nom-ui'

const props = defineProps<{
  title: string
  description: string
  submitLabel: string
  initial?: ProjectMetadata
  /** Extra check on the amounts (e.g. phase funds vs project funds). */
  fundsError?: (znn: bigint, qsr: bigint) => string | null
  /** Offer to fill in these amounts (what the project has left). */
  remaining?: { znn: bigint; qsr: bigint }
  busy?: boolean
}>()

const emit = defineEmits<{
  submit: [metadata: ProjectMetadata]
  close: []
}>()

const name = ref(props.initial?.name ?? '')
const text = ref(props.initial?.description ?? '')
const url = ref(props.initial?.url ?? '')
const znn = ref(props.initial ? formatAmount(props.initial.znn, 8) : '')
const qsr = ref(props.initial ? formatAmount(props.initial.qsr, 8) : '')
const touched = ref(false)

const parsed = computed(() => ({
  name: name.value.trim(),
  description: text.value.trim(),
  url: url.value.trim(),
  znn: parseAmount(znn.value || '0', 8),
  qsr: parseAmount(qsr.value || '0', 8),
}))
const errors = computed(() => {
  const e: Record<string, string | undefined> = { ...metadataErrors(parsed.value) }
  const { znn: z, qsr: q } = parsed.value
  if (!e.znn && !e.qsr && z !== null && q !== null && props.fundsError) {
    const fundsError = props.fundsError(z, q)
    if (fundsError) e.funds = fundsError
  }
  return e
})
const valid = computed(() => Object.values(errors.value).every((v) => !v))

function useRemaining() {
  if (!props.remaining) return
  znn.value = formatAmount(props.remaining.znn, 8)
  qsr.value = formatAmount(props.remaining.qsr, 8)
}

function submit() {
  touched.value = true
  const p = parsed.value
  if (!valid.value || props.busy || p.znn === null || p.qsr === null) return
  emit('submit', { name: p.name, description: p.description, url: p.url, znn: p.znn, qsr: p.qsr })
}
</script>

<template>
  <Dialog :open="true" @update:open="(v) => !v && !busy && emit('close')">
    <DialogContent class="max-w-lg">
      <DialogHeader>
        <DialogTitle>{{ title }}</DialogTitle>
        <DialogDescription>{{ description }}</DialogDescription>
      </DialogHeader>
      <form @submit.prevent="submit">
        <FieldGroup>
          <Field>
            <FieldLabel for="project-name">Name</FieldLabel>
            <Input id="project-name" v-model="name" :disabled="busy" />
            <FieldDescription :class="{ 'text-destructive': touched && errors.name }">
              {{ (touched && errors.name) || `${byteLength(name.trim())}/${PROJECT_NAME_MAX_BYTES}` }}
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel for="project-description">Description</FieldLabel>
            <Textarea id="project-description" v-model="text" class="min-h-[80px]" :disabled="busy" />
            <FieldDescription :class="{ 'text-destructive': touched && errors.description }">
              {{ (touched && errors.description) || `${byteLength(text.trim())}/${PROJECT_DESCRIPTION_MAX_BYTES}` }}
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel for="project-url">Link</FieldLabel>
            <Input id="project-url" v-model="url" placeholder="https://example.com/proposal" :disabled="busy" />
            <FieldDescription v-if="touched && errors.url" class="text-destructive">{{ errors.url }}</FieldDescription>
          </Field>
          <div class="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel for="project-znn">ZNN requested</FieldLabel>
              <Input id="project-znn" v-model="znn" inputmode="decimal" placeholder="0" :disabled="busy" />
              <FieldDescription v-if="touched && errors.znn" class="text-destructive">{{ errors.znn }}</FieldDescription>
            </Field>
            <Field>
              <FieldLabel for="project-qsr">QSR requested</FieldLabel>
              <Input id="project-qsr" v-model="qsr" inputmode="decimal" placeholder="0" :disabled="busy" />
              <FieldDescription v-if="touched && errors.qsr" class="text-destructive">{{ errors.qsr }}</FieldDescription>
            </Field>
          </div>
          <div v-if="remaining" class="flex items-center justify-between text-xs text-muted-foreground">
            <span>Project has {{ formatAmount(remaining.znn, 8) }} ZNN / {{ formatAmount(remaining.qsr, 8) }} QSR left</span>
            <Button type="button" size="sm" variant="outline" :disabled="busy" @click="useRemaining">Use all</Button>
          </div>
          <p v-if="touched && errors.funds" class="text-sm text-destructive">{{ errors.funds }}</p>
          <div class="flex justify-end gap-2">
            <Button type="button" variant="outline" :disabled="busy" @click="emit('close')">Cancel</Button>
            <Button type="submit" :disabled="busy || (touched && !valid)">{{ submitLabel }}</Button>
          </div>
        </FieldGroup>
      </form>
    </DialogContent>
  </Dialog>
</template>
