import type { IDataObject, IExecuteFunctions, IHttpRequestOptions } from 'n8n-workflow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('n8n-workflow', async (importOriginal) => {
	const original = await importOriginal<typeof import('n8n-workflow')>();
	return { ...original, sleep: vi.fn(async () => undefined) };
});

import { sleep } from 'n8n-workflow';

import { Tibios } from '../nodes/Tibios/Tibios.node';

const credentials = {
	baseUrl: 'https://gw.example.com/',
	fleetId: 'F1',
	invitationToken: 'invite',
};

type Answer = unknown | ((options: IHttpRequestOptions) => unknown);

function context(parameters: IDataObject, answers: Answer[], plain: Answer[] = []) {
	const authenticated: Array<{ credential: string; options: IHttpRequestOptions }> = [];
	const anonymous: IHttpRequestOptions[] = [];
	const reply = (queue: Answer[], options: IHttpRequestOptions) => {
		const next = queue.shift();
		if (next instanceof Error) throw next;
		return typeof next === 'function' ? next(options) : next;
	};
	const ctx = {
		getInputData: () => [{ json: {} }],
		getNodeParameter: (name: string, _i: number, fallback?: unknown) =>
			name in parameters ? parameters[name] : fallback,
		getCredentials: async () => credentials,
		getNode: () => ({ name: 'TibiOS', type: 'n8n-nodes-tibios.tibios', typeVersion: 1 }),
		continueOnFail: () => false,
		helpers: {
			httpRequestWithAuthentication: vi.fn(
				async (credential: string, options: IHttpRequestOptions) => {
					authenticated.push({ credential, options });
					return reply(answers, options);
				},
			),
			httpRequest: vi.fn(async (options: IHttpRequestOptions) => {
				anonymous.push(options);
				return reply(plain, options);
			}),
		},
	};
	return { ctx: ctx as unknown as IExecuteFunctions, authenticated, anonymous };
}

async function run(ctx: IExecuteFunctions) {
	const [items] = await new Tibios().execute.call(ctx);
	return items.map((item) => item.json);
}

beforeEach(() => vi.mocked(sleep).mockClear());

describe('Chat → Ask the fleet', () => {
	it('posts the chat with the credential and returns the clean answer', async () => {
		const { ctx, authenticated } = context(
			{ resource: 'chat', operation: 'ask', model: 'kimi-k3', prompt: 'Hi', searchTheWeb: true },
			[{ model: 'kimi-k3', choices: [{ message: { content: 'Hello!  (@kimi)' } }] }],
		);
		expect(await run(ctx)).toEqual([
			{ answer: 'Hello!', lane: '@kimi', model: 'kimi-k3', usage: null },
		]);
		expect(authenticated).toHaveLength(1);
		expect(authenticated[0].credential).toBe('tibiOSApi');
		expect(authenticated[0].options).toMatchObject({
			method: 'POST',
			url: 'https://gw.example.com/fleet/F1/v1/chat/completions',
			body: {
				model: 'kimi-k3',
				messages: [{ role: 'user', content: 'Busca en internet Hi' }],
			},
		});
	});

	it('wraps an HTTP failure as an API error', async () => {
		const { ctx } = context({ resource: 'chat', operation: 'ask', prompt: 'Hi' }, [
			Object.assign(new Error('Request failed with status code 403'), { httpCode: '403' }),
		]);
		await expect(run(ctx)).rejects.toThrow();
	});
});

describe('Flow → Run', () => {
	const pending = { id: 'R1', status: 'pending', trace: [{ step: 'agent', output: 'draft' }] };
	const done = {
		id: 'R1',
		status: 'done',
		trace: [
			{ step: 'agent', output: 'draft' },
			{ step: 'send', output: 'Sent: draft' },
		],
		outputs: { b2: 'draft' },
	};

	it('returns at once when asked not to wait', async () => {
		const { ctx, authenticated } = context(
			{ resource: 'flow', operation: 'run', flow: 'triage', text: 'lead', waitForResult: false },
			[pending],
		);
		const [item] = await run(ctx);
		expect(item).toMatchObject({
			runId: 'R1',
			status: 'pending',
			finished: false,
			finalOutput: 'draft',
		});
		expect(authenticated[0].options).toMatchObject({
			method: 'POST',
			url: 'https://gw.example.com/runs/F1/flows/triage/run',
			body: { text: 'lead', from: 'n8n' },
		});
		expect(sleep).not.toHaveBeenCalled();
	});

	it('polls the run until it finishes', async () => {
		const { ctx, authenticated } = context(
			{
				resource: 'flow',
				operation: 'run',
				flow: 'triage',
				text: 'lead',
				dry: true,
				pollInterval: 5,
			},
			[pending, pending, done],
		);
		const [item] = await run(ctx);
		expect(item).toMatchObject({
			runId: 'R1',
			status: 'done',
			finished: true,
			finalOutput: 'Sent: draft',
		});
		expect(authenticated.map((call) => call.options.url)).toEqual([
			'https://gw.example.com/runs/F1/flows/triage/run',
			'https://gw.example.com/runs/F1/R1',
			'https://gw.example.com/runs/F1/R1',
		]);
		expect(authenticated[0].options.body).toMatchObject({ dry: true });
		expect(sleep).toHaveBeenCalledTimes(2);
		expect(sleep).toHaveBeenCalledWith(5000);
	});

	it('gives up at the timeout and says so', async () => {
		vi.useFakeTimers();
		vi.mocked(sleep).mockImplementation(async (ms: number) => {
			vi.advanceTimersByTime(ms);
		});
		try {
			const { ctx } = context(
				{
					resource: 'flow',
					operation: 'run',
					flow: 'triage',
					text: 'lead',
					pollInterval: 60,
					timeout: 1,
				},
				[pending, pending, pending, pending],
			);
			const [item] = await run(ctx);
			expect(item).toMatchObject({ runId: 'R1', status: 'pending', timedOut: true });
		} finally {
			vi.useRealTimers();
			vi.mocked(sleep).mockImplementation(async () => undefined);
		}
	});
});

describe('Flow → Get a run', () => {
	it('reads one run', async () => {
		const { ctx, authenticated } = context(
			{ resource: 'flow', operation: 'getRun', runId: ' R9 ' },
			[{ id: 'R9', status: 'failed', trace: [{ step: 'flow', error: 'boom' }] }],
		);
		expect(await run(ctx)).toEqual([
			{
				runId: 'R9',
				status: 'failed',
				finished: true,
				finalOutput: null,
				outputs: {},
				trace: [{ step: 'flow', error: 'boom' }],
			},
		]);
		expect(authenticated[0].options.url).toBe('https://gw.example.com/runs/F1/R9');
	});
});

describe('Flow → Trigger via webhook link', () => {
	it('sends the key without the invitation', async () => {
		const { ctx, authenticated, anonymous } = context(
			{ resource: 'flow', operation: 'triggerWebhook', flow: 'inbox', webhookKey: 'k', text: 'hi' },
			[],
			[{ id: 'R2', status: 'running', trace: [] }],
		);
		const [item] = await run(ctx);
		expect(item).toMatchObject({ runId: 'R2', status: 'running' });
		expect(authenticated).toHaveLength(0);
		expect(anonymous[0]).toMatchObject({
			method: 'POST',
			url: 'https://gw.example.com/runs/F1/flows/inbox/hook',
			headers: { 'X-Flow-Key': 'k' },
			body: { text: 'hi' },
		});
	});

	it('returns an answer that is not a run as it came', async () => {
		const { ctx } = context(
			{ resource: 'flow', operation: 'triggerWebhook', flow: 'inbox', webhookKey: 'k', text: 'hi' },
			[],
			[{ accepted: true }],
		);
		expect(await run(ctx)).toEqual([{ response: { accepted: true } }]);
	});
});

describe('dropdowns', () => {
	it('lists auto first, then the fleet models', async () => {
		const { ctx } = context({}, [{ data: [{ id: 'kimi-k3' }, { id: 'auto' }, { id: '@orin' }] }]);
		const options = await new Tibios().methods.loadOptions.getModels.call(ctx as never);
		expect(options.map((option) => option.value)).toEqual(['auto', 'kimi-k3', '@orin']);
	});

	it('lists flows by name with their slug as value', async () => {
		const { ctx } = context({}, [
			{ flows: [{ slug: 'triage', name: 'Lead triage', trigger: 'webhook' }] },
		]);
		expect(await new Tibios().methods.loadOptions.getFlows.call(ctx as never)).toEqual([
			{ name: 'Lead triage', value: 'triage', description: 'Trigger: webhook' },
		]);
	});
});
