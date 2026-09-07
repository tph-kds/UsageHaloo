<script lang="ts">
  let { detected, onConnect } = $props<{
    detected: Array<{ id: string; name: string }>;
    onConnect: () => void;
  }>();
</script>

<section class="welcome" aria-label="Welcome">
  <h2>Welcome to UsageHaloo</h2>
  <p>Track AI usage from the providers you actually use. Nothing is connected yet, so every number on this page is honestly empty.</p>
  <button class="primary" onclick={onConnect}>+ Connect your first provider</button>
  {#if detected.length}
    <div class="detected-block">
      <h3>Detected on this computer</h3>
      {#each detected as d}
        <div class="row"><span>{d.name}</span><button class="ghost" onclick={onConnect}>Connect</button></div>
      {/each}
      <p class="note">Detection is only a suggestion. Detected providers contribute to no totals until you connect them.</p>
    </div>
  {/if}
  <div class="other">
    <h3>Other integrations</h3>
    <p>OpenRouter · OpenAI API · Anthropic API · Ollama · LM Studio · and more.</p>
  </div>
</section>

<style>
  .welcome { border: 1px solid var(--line); background: var(--panel); border-radius: 16px; padding: 28px; display: grid; gap: 12px; justify-items: start; }
  h2 { margin: 0; font-size: 26px; letter-spacing: -0.03em; }
  p { margin: 0; color: var(--muted); font-size: 13px; max-width: 60ch; line-height: 1.6; }
  .primary { border: 0; background: var(--ink); color: var(--bg); padding: 11px 18px; border-radius: 12px; font-weight: 800; cursor: pointer; }
  .detected-block, .other { width: 100%; border-top: 1px solid var(--line); padding-top: 14px; }
  h3 { font-size: 12px; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); margin: 0 0 8px; }
  .row { display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid var(--line); font-size: 13px; }
  .ghost { border: 1px solid var(--line); background: transparent; color: inherit; padding: 7px 12px; border-radius: 10px; cursor: pointer; }
  .note { font-size: 12px; }
</style>
