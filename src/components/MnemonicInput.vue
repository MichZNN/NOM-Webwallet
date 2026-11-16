<script setup lang="ts">
import {computed, nextTick, ref, watch} from 'vue'
import {phraseStatus, splitPhrase, suggestions, wordState} from '@/core/mnemonic-input'
import {Button, Textarea} from 'nom-ui'

/**
 * Recovery phrase entry like the desktop wallet: one field per word, each
 * checked against the BIP39 list as you type (with suggestions), or a single
 * box to paste the whole phrase. Emits the phrase once it is complete and its
 * checksum is valid, else null.
 */
const emit = defineEmits<{ phrase: [phrase: string | null] }>()

const mode = ref<'words' | 'paste'>('words')
const length = ref<12 | 24>(12)
const words = ref<string[]>(Array(24).fill(''))
const pasted = ref('')
const active = ref<number | null>(null)
const inputs = ref<HTMLInputElement[]>([])

/** Still typing: the focused field holds the start of a list word. */
const typing = (i: number) =>
  i === active.value && wordState(words.value[i]) === 'invalid' && suggestions(words.value[i]).length > 0

const current = computed(() =>
  mode.value === 'words'
    ? // A word still being typed counts as not entered yet, not as wrong.
      words.value.slice(0, length.value).map((w, i) => (typing(i) ? '' : w))
    : splitPhrase(pasted.value)
)
const status = computed(() =>
  mode.value === 'words' ? phraseStatus(current.value, length.value) : phraseStatus(current.value)
)
watch(status, (s) => emit('phrase', s.kind === 'valid' ? s.phrase : null), { immediate: true })

const hints = computed(() => (active.value === null ? [] : suggestions(words.value[active.value] ?? '')))

const message = computed(() => {
  const s = status.value
  switch (s.kind) {
    case 'valid':
      return { tone: 'ok', text: 'Valid recovery phrase' }
    case 'unknown-words':
      return { tone: 'error', text: `Not a recovery-phrase word: #${s.positions.join(', #')}` }
    case 'bad-checksum':
      return { tone: 'error', text: 'All words are valid, but the phrase is not: check the order and spelling' }
    case 'wrong-length':
      return { tone: 'error', text: `${s.count} words; a recovery phrase has 12 or 24` }
    case 'incomplete':
      return { tone: 'muted', text: `${s.filled} of ${s.length} words` }
  }
  return { tone: 'muted', text: '' }
})

function focus(i: number) {
  void nextTick(() => inputs.value[i]?.focus())
}

/** Pasting several words into a field spreads them over the fields from there. */
function onPaste(i: number, event: ClipboardEvent) {
  const parts = splitPhrase(event.clipboardData?.getData('text') ?? '')
  if (parts.length < 2) return
  event.preventDefault()
  if (i === 0 && parts.length > 12) length.value = 24
  const next = [...words.value]
  parts.slice(0, 24 - i).forEach((w, k) => (next[i + k] = w))
  words.value = next
  focus(Math.min(i + parts.length, length.value - 1))
}

function onKey(i: number, event: KeyboardEvent) {
  if (event.key === ' ' || event.key === 'Enter') {
    event.preventDefault()
    const hint = hints.value
    // Complete to the only suggestion, then move on.
    if (hint.length === 1 && wordState(words.value[i]) !== 'valid') words.value[i] = hint[0]
    if (i + 1 < length.value) focus(i + 1)
  } else if (event.key === 'Backspace' && !words.value[i] && i > 0) {
    focus(i - 1)
  }
}

function pick(word: string) {
  if (active.value === null) return
  const i = active.value
  words.value[i] = word
  if (i + 1 < length.value) focus(i + 1)
}

function setMode(m: 'words' | 'paste') {
  if (m === mode.value) return
  if (m === 'paste') pasted.value = current.value.filter(Boolean).join(' ')
  else {
    const parts = splitPhrase(pasted.value)
    if (parts.length > 12) length.value = 24
    words.value = Array.from({ length: 24 }, (_, k) => parts[k] ?? '')
  }
  mode.value = m
}

const fieldClass = (w: string, i: number) => {
  const s = typing(i) ? 'empty' : wordState(w)
  return s === 'valid'
    ? 'border-success/60'
    : s === 'invalid'
      ? 'border-destructive text-destructive'
      : 'border-input'
}
</script>

<template>
  <div class="space-y-3">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div class="flex gap-1" role="group" aria-label="How to enter the phrase">
        <Button type="button" size="sm" :variant="mode === 'words' ? 'default' : 'outline'" @click="setMode('words')">
          Word by word
        </Button>
        <Button type="button" size="sm" :variant="mode === 'paste' ? 'default' : 'outline'" @click="setMode('paste')">
          Paste phrase
        </Button>
      </div>
      <div v-if="mode === 'words'" class="flex gap-1" role="group" aria-label="Number of words">
        <Button type="button" size="sm" :variant="length === 12 ? 'default' : 'outline'" @click="length = 12">12</Button>
        <Button type="button" size="sm" :variant="length === 24 ? 'default' : 'outline'" @click="length = 24">24</Button>
      </div>
    </div>

    <div v-if="mode === 'words'" class="grid grid-cols-2 gap-2 sm:grid-cols-3">
      <label
        v-for="i in length"
        :key="i"
        class="flex items-center gap-1 rounded-md border bg-background px-2 py-1 text-sm"
        :class="fieldClass(words[i - 1], i - 1)"
      >
        <span class="w-5 shrink-0 text-right text-xs text-muted-foreground">{{ i }}</span>
        <input
          :ref="(el) => { if (el) inputs[i - 1] = el as HTMLInputElement }"
          v-model="words[i - 1]"
          :aria-label="`Word ${i}`"
          :aria-invalid="!typing(i - 1) && wordState(words[i - 1]) === 'invalid'"
          class="w-full min-w-0 bg-transparent font-mono outline-none"
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
          @focus="active = i - 1"
          @blur="active = null"
          @paste="onPaste(i - 1, $event)"
          @keydown="onKey(i - 1, $event)"
        />
      </label>
    </div>
    <div v-if="mode === 'words' && hints.length && wordState(words[active ?? 0]) !== 'valid'" class="flex flex-wrap gap-1">
      <Button v-for="h in hints" :key="h" type="button" size="sm" variant="outline" @mousedown.prevent="pick(h)">
        {{ h }}
      </Button>
    </div>

    <Textarea
      v-if="mode === 'paste'"
      v-model="pasted"
      aria-label="Recovery phrase"
      placeholder="word1 word2 word3 ..."
      class="min-h-[80px] font-mono"
      autocomplete="off"
      autocapitalize="off"
      spellcheck="false"
    />

    <p
      class="text-sm"
      :class="{ 'text-success': message.tone === 'ok', 'text-destructive': message.tone === 'error', 'text-muted-foreground': message.tone === 'muted' }"
    >
      {{ message.text }}
    </p>
  </div>
</template>
