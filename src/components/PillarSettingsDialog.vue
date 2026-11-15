<script setup lang="ts">
import {computed, ref} from 'vue'
import {Address} from 'znn-typescript-sdk'
import type {PillarSettings} from '@/core'
import {percentageError, pillarNameError} from '@/core/node-rules'
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  Input,
} from 'nom-ui'

const props = defineProps<{
  mode: 'register' | 'update'
  initial: PillarSettings
  busy?: boolean
}>()

const emit = defineEmits<{
  submit: [settings: PillarSettings]
  close: []
}>()

const name = ref(props.initial.name)
const producer = ref(props.initial.producer)
const reward = ref(props.initial.reward)
const giveMomentum = ref(props.initial.giveMomentumPercentage)
const giveDelegate = ref(props.initial.giveDelegatePercentage)

function addressError(value: string): string | null {
  try {
    Address.parse(value.trim())
    return null
  } catch {
    return 'Not a valid z1… address'
  }
}

const errors = computed(() => ({
  name: props.mode === 'register' ? pillarNameError(name.value.trim()) : null,
  producer: addressError(producer.value),
  reward: addressError(reward.value),
  giveMomentum: percentageError(Number(giveMomentum.value)),
  giveDelegate: percentageError(Number(giveDelegate.value)),
}))

const changed = computed(
  () =>
    props.mode === 'register' ||
    producer.value.trim() !== props.initial.producer ||
    reward.value.trim() !== props.initial.reward ||
    Number(giveMomentum.value) !== props.initial.giveMomentumPercentage ||
    Number(giveDelegate.value) !== props.initial.giveDelegatePercentage
)

const valid = computed(() => Object.values(errors.value).every((e) => e === null))

function submit() {
  if (!valid.value || !changed.value || props.busy) return
  emit('submit', {
    name: name.value.trim(),
    producer: producer.value.trim(),
    reward: reward.value.trim(),
    giveMomentumPercentage: Number(giveMomentum.value),
    giveDelegatePercentage: Number(giveDelegate.value),
  })
}
</script>

<template>
  <Dialog :open="true" @update:open="(v) => !v && !busy && emit('close')">
    <DialogContent class="max-w-lg">
      <DialogHeader>
        <DialogTitle>{{ mode === 'register' ? 'Register Pillar' : `Update ${initial.name}` }}</DialogTitle>
      </DialogHeader>

      <form @submit.prevent="submit">
        <FieldGroup>
          <Field v-if="mode === 'register'">
            <FieldLabel for="pillar-name">Pillar Name</FieldLabel>
            <Input id="pillar-name" v-model="name" maxlength="40" :disabled="busy" />
            <FieldDescription :class="{ 'text-destructive': name && errors.name }">
              {{ (name && errors.name) || 'Permanent; it cannot be changed after registration.' }}
            </FieldDescription>
          </Field>

          <Field>
            <FieldLabel for="pillar-producer">Producer Address</FieldLabel>
            <Input id="pillar-producer" v-model="producer" class="font-mono" :disabled="busy" />
            <FieldDescription :class="{ 'text-destructive': errors.producer }">
              {{
                errors.producer ||
                'The address your pillar node signs momentums with. It must not be used by another pillar.'
              }}
            </FieldDescription>
          </Field>

          <Field>
            <FieldLabel for="pillar-reward">Reward Address</FieldLabel>
            <Input id="pillar-reward" v-model="reward" class="font-mono" :disabled="busy" />
            <FieldDescription :class="{ 'text-destructive': errors.reward }">
              {{ errors.reward || 'Where the pillar rewards can be collected.' }}
            </FieldDescription>
          </Field>

          <div class="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel for="pillar-give-momentum">Momentum rewards to delegators (%)</FieldLabel>
              <Input
                id="pillar-give-momentum"
                v-model.number="giveMomentum"
                type="number"
                min="0"
                max="100"
                step="1"
                :disabled="busy"
              />
              <FieldDescription v-if="errors.giveMomentum" class="text-destructive">
                {{ errors.giveMomentum }}
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel for="pillar-give-delegate">Delegation rewards to delegators (%)</FieldLabel>
              <Input
                id="pillar-give-delegate"
                v-model.number="giveDelegate"
                type="number"
                min="0"
                max="100"
                step="1"
                :disabled="busy"
              />
              <FieldDescription v-if="errors.giveDelegate" class="text-destructive">
                {{ errors.giveDelegate }}
              </FieldDescription>
            </Field>
          </div>

          <div class="flex justify-end gap-2">
            <Button type="button" variant="outline" :disabled="busy" @click="emit('close')">
              Cancel
            </Button>
            <Button type="submit" :disabled="!valid || !changed || busy">
              {{ mode === 'register' ? 'Register' : 'Save Changes' }}
            </Button>
          </div>
        </FieldGroup>
      </form>
    </DialogContent>
  </Dialog>
</template>
