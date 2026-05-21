<script lang="ts">
  type HealthResult =
    | { state: 'loading' }
    | { state: 'ok'; status: string }
    | { state: 'error'; message: string };

  let result = $state<HealthResult>({ state: 'loading' });

  $effect(() => {
    fetch('/health')
      .then((res) => res.json())
      .then((data: { status: string }) => {
        result = { state: 'ok', status: data.status };
      })
      .catch((err: unknown) => {
        result = {
          state: 'error',
          message: err instanceof Error ? err.message : 'Unknown error',
        };
      });
  });
</script>

<h1>mediform — Patient App</h1>

{#if result.state === 'loading'}
  <p>Loading…</p>
{:else if result.state === 'error'}
  <p>Error: {result.message}</p>
{:else}
  <p>API status: {result.status}</p>
{/if}
