<script lang="ts">
  /**
   * One control per `ParamSpec`.
   *
   * `ParamSpec` is deliberately sufficient to render a settings control with no
   * per-plugin UI code — that's the whole point of declaring type/min/max/step/unit
   * rather than leaving validation to the plugin. A user-supplied stop plugin gets a
   * usable settings row for free, and `plugins/host/validate.ts` refuses a plugin whose
   * numeric param omits `min` or `max`, which is what lets this trust them outright.
   *
   * ## A typed field, not a slider
   *
   * These are exact quantities — a length of 200, a factor of 2.5 — and a slider can't
   * express one. Dragging to 200 across a 2–200 range is a pixel-hunt, and the value
   * you land on is whatever the pointer happened to be over. The sliders worth keeping
   * are volume and scroll speed, where the number is meaningless and the feel is the
   * point; those are separate controls and untouched.
   *
   * The cost of a text field is that it can hold something invalid, which a slider
   * cannot. Three rules handle it:
   *
   *   - **Committed on blur or Enter, never per keystroke.** With `min: 2` on SMA's
   *     length, clamping as you type turns `20` into `2` the moment the first key
   *     lands. This is the rule that makes a bounded number field usable at all.
   *   - **Out of range clamps to the bound.** Note this is the opposite of the
   *     persistence rule in `config/storedConfig.ts`, which rejects rather than clamps —
   *     deliberately, because that reads *stored* data where an impossible value is
   *     evidence of corruption. A person typing 500 into a field capped at 200 is
   *     expressing intent, and clamping reads it correctly.
   *   - **Unparseable reverts.** Empty, `abc`, a stray minus sign mid-edit: the field
   *     goes back to the value it had rather than to zero, which is what "I changed my
   *     mind" should do.
   */
  import type { ParamSpec } from '@shared/contracts/index.js'

  let {
    spec,
    value,
    onChange,
    inGrid = false,
  }: {
    spec: ParamSpec
    value: number
    onChange: (next: number) => void
    /**
     * Contribute cells to the caller's grid instead of laying out as its own row.
     *
     * The indicator panel puts params and outputs in one grid so their columns line up
     * down the whole list — boxes that each sized to their own label read as unrelated
     * controls, and the eye can't scan a column to compare them. That only works if
     * these cells are grid items of *that* grid, which is what `display: contents`
     * below achieves: the label keeps associating its control by containment (that's a
     * DOM relationship, not a layout one) while generating no box of its own.
     *
     * Off by default, so the stops panel — one param, no outputs, nothing to align
     * against — keeps its own compact row.
     */
    inGrid?: boolean
  } = $props()

  /**
   * What's in the box mid-edit, which is deliberately allowed to disagree with `value`.
   *
   * Kept in step with the committed value when that changes from outside — adding an
   * indicator, or Cancel restoring a draft — but not while it's being typed into.
   */
  // Capturing the initial value is the point — the box holds text, not the number, and
  // the effect below re-syncs it whenever the committed value changes from outside.
  // svelte-ignore state_referenced_locally
  let text = $state(String(value))
  let editing = $state(false)
  $effect(() => {
    if (!editing) text = String(value)
  })

  const isNumeric = $derived(
    spec.type === 'int' || spec.type === 'float' || spec.type === 'percent'
  )

  /** Bounds are guaranteed for numeric types by the plugin validator. */
  const min = $derived(spec.min ?? Number.NEGATIVE_INFINITY)
  const max = $derived(spec.max ?? Number.POSITIVE_INFINITY)

  function commit(): void {
    editing = false
    const parsed = Number(text.trim())
    if (text.trim() === '' || !Number.isFinite(parsed)) {
      text = String(value)
      return
    }
    // Rounded for an int *before* clamping, so 200.6 against a max of 200 lands on 200
    // rather than being rejected as out of range and then rounded back down anyway.
    const rounded = spec.type === 'int' ? Math.round(parsed) : parsed
    const next = Math.min(max, Math.max(min, rounded))
    text = String(next)
    if (next !== value) onChange(next)
  }
</script>

{#if isNumeric}
  <label class="field" class:cells={inGrid}>
    <span class="name">{spec.displayName}</span>
    <input
      type="number"
      {min}
      {max}
      step={spec.step ?? (spec.type === 'int' ? 1 : 0.1)}
      value={text}
      oninput={(event) => {
        editing = true
        text = event.currentTarget.value
      }}
      onblur={commit}
      onkeydown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          commit()
          // Blur so the committed value is visibly what the field now holds; leaving
          // focus makes a clamped value look like it was ignored.
          event.currentTarget.blur()
        }
      }}
    />
    <!-- Unit and range share one cell so they occupy one grid column between them: two
         cells would push whatever the caller puts in the next column out by one.
         The range is shown rather than only enforced, because a value silently clamped
         on blur reads as a bug unless the limit was visible beforehand. -->
    <span class="meta">
      {#if spec.unit}<span class="unit">{spec.unit}</span>{/if}
      <span class="range">({spec.min}–{spec.max})</span>
    </span>
  </label>
{:else if spec.type === 'bool'}
  <label class="field" class:cells={inGrid}>
    <span class="name">{spec.displayName}</span>
    <input
      type="checkbox"
      checked={value !== 0}
      onchange={(event) => onChange(event.currentTarget.checked ? 1 : 0)}
    />
  </label>
{:else if spec.type === 'enum'}
  <label class="field" class:cells={inGrid}>
    <span class="name">{spec.displayName}</span>
    <!-- Stored as the option's index, because `ParamValues` is `Record<string, number>`.
         The plugin owns its `options` order, so reordering them is a plugin change that
         invalidates saved instances — the same as renaming a param key would. -->
    <select
      value={String(value)}
      onchange={(event) => onChange(Number(event.currentTarget.value))}
    >
      {#each spec.options ?? [] as option, index (option)}
        <option value={String(index)}>{option}</option>
      {/each}
    </select>
  </label>
{/if}

<style>
  /* Label immediately beside its box. A grid with the name at the left edge and the
     box at the right pushed the two apart by the full panel width, which reads as two
     unrelated things on one line rather than one labelled field. */
  .field {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    margin: 10px 0;
    font-size: 13.5px;
  }
  /**
   * In grid mode the label generates no box, so the three spans below become items of
   * the *caller's* grid and line up with whatever else it puts in those columns.
   *
   * Each side owns its half of the arrangement: the caller declares the columns, this
   * declares which of them a param row occupies. `grid-column: 1` on the name is what
   * starts a new row — auto-placement moves down when the explicit column is behind the
   * cursor — so the caller doesn't have to pad rows out to equal length.
   */
  .field.cells {
    display: contents;
  }
  .field.cells .name {
    grid-column: 1;
  }
  .field.cells input,
  .field.cells select {
    grid-column: 2;
    /* Right-aligned within its column so a row of boxes has its digits in a line. */
    justify-self: start;
  }
  .field.cells .meta {
    grid-column: 3;
  }
  .meta {
    display: inline-flex;
    align-items: baseline;
    gap: 6px;
  }
  input[type='number'] {
    /* 7ch fits `-1234.5`, so the common case never scrolls inside the field. */
    width: 7ch;
    padding: 4px 6px;
    border: 1px solid var(--edge);
    border-radius: 4px;
    background: var(--panel-solid);
    color: var(--ink);
    font-family: ui-monospace, Menlo, monospace;
    font-size: 13px;
    text-align: right;
    /* No spinners. They're a 12px-wide pair of arrows that steal a third of the field,
       and stepping to 200 one click at a time is worse than typing it. Arrow keys still
       step by `step`, so nothing is lost — see the `step` attribute above. */
    appearance: textfield;
  }
  input[type='number']::-webkit-outer-spin-button,
  input[type='number']::-webkit-inner-spin-button {
    appearance: none;
    margin: 0;
  }
  input[type='number']:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  .unit,
  .range {
    color: var(--dim);
    font-size: 12px;
  }
  .range {
    font-family: ui-monospace, Menlo, monospace;
  }
  input[type='checkbox'] {
    accent-color: var(--accent);
  }
  select {
    padding: 4px 6px;
    border: 1px solid var(--edge);
    border-radius: 4px;
    background: var(--panel-solid);
    color: var(--ink);
    font-size: 13px;
  }
</style>
