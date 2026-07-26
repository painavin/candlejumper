<script lang="ts">
  /**
   * One control per `ParamSpec`.
   *
   * `ParamSpec` is deliberately sufficient to render a settings control with no
   * per-plugin UI code — that's the whole point of declaring min/max/step/unit
   * rather than leaving validation to the plugin. A user-supplied stop plugin gets
   * a usable settings row for free.
   */
  import type { ParamSpec } from '@shared/contracts/index.js'

  let {
    spec,
    value,
    onChange,
  }: { spec: ParamSpec; value: number; onChange: (next: number) => void } = $props()
</script>

<label>
  {spec.displayName}
  <span class="value">{value}{spec.unit ?? ''}</span>
  <input
    type="range"
    min={spec.min ?? 0}
    max={spec.max ?? 100}
    step={spec.step ?? (spec.type === 'int' ? 1 : 0.1)}
    {value}
    oninput={(event) => onChange(Number(event.currentTarget.value))}
  />
</label>

<style>
  label {
    display: block;
    margin: 10px 0;
    font-size: 13.5px;
  }
  .value {
    float: right;
    color: var(--dim);
    font-family: ui-monospace, Menlo, monospace;
    font-size: 13px;
  }
  input {
    width: 100%;
    margin-top: 6px;
    accent-color: var(--accent);
  }
</style>
