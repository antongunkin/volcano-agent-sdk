import { describe, it, expect, vi } from 'vitest';
import { llmOpenAI } from '../../dist/volcano-agent-sdk.js';

// Mock the OpenAI client: a streaming response yields content deltas and a
// tool_call whose arguments are split across chunks (as the real API does).
vi.mock('openai', () => {
  class MockOpenAI {
    chat = {
      completions: {
        create: async (req: any) => {
          if (req.stream) {
            return (async function* () {
              yield { choices: [{ delta: { content: 'Let ' } }] };
              yield { choices: [{ delta: { content: 'me check.' } }] };
              yield { choices: [{ delta: { tool_calls: [{ index: 0, id: 't1', function: { name: 'mcp_abc123_get_sign', arguments: '{"birth' } }] } }] };
              yield { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'date":"1993-07-11"}' } }] } }] };
              yield { choices: [{ delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 } };
            })();
          }
          // non-streaming fallback (kept valid so the unfixed path doesn't crash)
          return { choices: [{ message: { content: null, tool_calls: [{ id: 't1', function: { name: 'mcp_abc123_get_sign', arguments: '{"birthdate":"1993-07-11"}' } }] } }] };
        }
      }
    };
    constructor(_: any) {}
  }
  return { default: MockOpenAI };
});

describe('OpenAI genWithTools streaming (unit)', () => {
  it('streams content tokens via onToken and reconstructs tool calls from deltas', async () => {
    const llm: any = llmOpenAI({ apiKey: 'sk-test', model: 'gpt-5-mini' });
    const tools = [
      { name: 'mcp_abc123.get_sign', description: 'x', parameters: { type: 'object', properties: {} } },
    ];
    const received: string[] = [];

    const result = await llm.genWithTools('what sign?', tools, (t: string) => received.push(t));

    // content streamed token-by-token
    expect(received.join('')).toBe('Let me check.');
    // tool call reconstructed from the split deltas and mapped back to its dotted name
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe('mcp_abc123.get_sign');
    expect(result.toolCalls[0].arguments.birthdate).toBe('1993-07-11');
  });
});
