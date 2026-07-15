import { spawn } from 'node:child_process';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { agent, mcp } from '../dist/volcano-agent-sdk.js';

function waitForOutput(proc: any, match: RegExp, timeoutMs = 15000) {
  return new Promise<void>((resolve, reject) => {
    const onData = (data: Buffer) => { if (match.test(data.toString())) { cleanup(); resolve(); } };
    const onErr = (data: Buffer) => { if (match.test(data.toString())) { cleanup(); resolve(); } };
    const cleanup = () => { proc.stdout?.off('data', onData); proc.stderr?.off('data', onErr); clearTimeout(timer); };
    proc.stdout?.on('data', onData); proc.stderr?.on('data', onErr);
    const timer = setTimeout(() => { cleanup(); reject(new Error('Timeout waiting for server output')); }, timeoutMs);
  });
}
function startServer(cmd: string, args: string[], env: Record<string, string | undefined> = {}) {
  return spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } });
}

describe('token streaming with tools (unit - mocked LLM)', () => {
  let astroProc: any;
  const PORT = '3298';

  beforeAll(async () => {
    astroProc = startServer('node', ['mcp/astro/server.mjs'], { PORT });
    await waitForOutput(astroProc, new RegExp(`astro-mcp\\] listening on :${PORT}`));
  }, 20000);

  afterAll(async () => { astroProc?.kill(); });

  it('forwards step onToken to genWithTools so the final answer streams during a tool step', async () => {
    const received: string[] = [];

    // Fake LLM whose tool-generation streams tokens *if* it is given an onToken callback.
    const fakeLlm = {
      id: 'Fake-LLM',
      model: 'fake',
      client: {},
      async gen() { return 'done'; },
      async *genStream() { /* noop */ },
      async genWithTools(_prompt: string, _tools: any[], onToken?: (t: string) => void) {
        if (onToken) { onToken('It '); onToken('is '); onToken('rainy.'); }
        return { content: 'It is rainy.', toolCalls: [] };
      },
    } as any;

    const astro = mcp(`http://localhost:${PORT}/mcp`);

    await agent({ llm: fakeLlm, hideProgress: true })
      .then({ prompt: 'weather?', mcps: [astro], onToken: (t: string) => received.push(t) })
      .run();

    // Before the fix the executor calls genWithTools(prompt, tools) with no onToken,
    // so nothing streams and this is empty.
    expect(received.join('')).toBe('It is rainy.');
  });
});
