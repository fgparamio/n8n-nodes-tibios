import { describe, expect, it } from 'vitest';

import {
	chatRequest,
	connectionFrom,
	finalOutput,
	flowsRequest,
	getRunRequest,
	modelsRequest,
	parseChatResponse,
	parseFlows,
	parseModels,
	parseRun,
	runFlowRequest,
	splitLaneSignature,
	webhookRequest,
} from '../nodes/Tibios/helpers';

const where = { baseUrl: 'https://gw.tibios.ai', fleetId: '3xAmpLeF1eetXyZ7' };

describe('connectionFrom', () => {
	it('trims the base URL and the fleet ID', () => {
		expect(connectionFrom({ baseUrl: ' https://gw.example.com// ', fleetId: ' F1 ' })).toEqual({
			baseUrl: 'https://gw.example.com',
			fleetId: 'F1',
		});
	});

	it('falls back to the public gateway', () => {
		expect(connectionFrom({ fleetId: 'F1' }).baseUrl).toBe('https://gw.tibios.ai');
	});
});

describe('request building', () => {
	it('asks the fleet with only the user message by default', () => {
		const request = chatRequest(where, { model: 'auto', prompt: '  Hello  ' });
		expect(request.method).toBe('POST');
		expect(request.url).toBe('https://gw.tibios.ai/fleet/3xAmpLeF1eetXyZ7/v1/chat/completions');
		expect(request.json).toBe(true);
		expect(request.body).toEqual({ model: 'auto', messages: [{ role: 'user', content: 'Hello' }] });
	});

	it('adds the system prompt, the web search prefix and max_tokens', () => {
		const request = chatRequest(where, {
			model: '@orin',
			prompt: 'the weather in Madrid',
			systemPrompt: 'Answer in one line',
			searchTheWeb: true,
			maxTokens: 200,
		});
		expect(request.body).toEqual({
			model: '@orin',
			max_tokens: 200,
			messages: [
				{ role: 'system', content: 'Answer in one line' },
				{ role: 'user', content: 'Busca en internet the weather in Madrid' },
			],
		});
	});

	it('uses auto when the model is empty and skips an empty system prompt', () => {
		const request = chatRequest(where, { model: ' ', prompt: 'hi', systemPrompt: '  ' });
		expect(request.body).toEqual({ model: 'auto', messages: [{ role: 'user', content: 'hi' }] });
	});

	it('builds the models, flows and run URLs', () => {
		expect(modelsRequest(where)).toMatchObject({
			method: 'GET',
			url: 'https://gw.tibios.ai/fleet/3xAmpLeF1eetXyZ7/v1/models',
		});
		expect(flowsRequest(where)).toMatchObject({
			method: 'GET',
			url: 'https://gw.tibios.ai/runs/3xAmpLeF1eetXyZ7/flows',
		});
		expect(getRunRequest(where, '20261123101500-a1b2c3')).toMatchObject({
			method: 'GET',
			url: 'https://gw.tibios.ai/runs/3xAmpLeF1eetXyZ7/20261123101500-a1b2c3',
		});
	});

	it('runs a flow as n8n, and sends dry only when asked', () => {
		expect(runFlowRequest(where, 'triage', 'a new lead', false)).toMatchObject({
			method: 'POST',
			url: 'https://gw.tibios.ai/runs/3xAmpLeF1eetXyZ7/flows/triage/run',
			body: { text: 'a new lead', from: 'n8n' },
		});
		expect(runFlowRequest(where, 'triage', 'x', false).body).not.toHaveProperty('dry');
		expect(runFlowRequest(where, 'triage', 'x', true).body).toEqual({
			text: 'x',
			from: 'n8n',
			dry: true,
		});
	});

	it('triggers a webhook flow with its key and no invitation', () => {
		const request = webhookRequest(where, 'inbox', 's3cret', 'hello');
		expect(request).toMatchObject({
			method: 'POST',
			url: 'https://gw.tibios.ai/runs/3xAmpLeF1eetXyZ7/flows/inbox/hook',
			headers: { 'X-Flow-Key': 's3cret' },
			body: { text: 'hello' },
		});
		expect(request.headers).not.toHaveProperty('Authorization');
	});

	it('escapes path segments', () => {
		expect(getRunRequest(where, '../x').url).toBe(
			'https://gw.tibios.ai/runs/3xAmpLeF1eetXyZ7/..%2Fx',
		);
	});
});

describe('splitLaneSignature', () => {
	it.each([
		['Hola.  (@orin)', 'Hola.', '@orin'],
		['Hola.\n\n(@kimi)', 'Hola.', '@kimi'],
		['Hola. — @air', 'Hola.', '@air'],
		['Hola. (@orin) (@kimi)', 'Hola.', '@kimi'],
	])('takes the signature off %j', (text, answer, lane) => {
		expect(splitLaneSignature(text)).toEqual({ answer, lane });
	});

	it('leaves an unsigned answer and a mention in the middle alone', () => {
		expect(splitLaneSignature('Ask (@orin) about it.')).toEqual({
			answer: 'Ask (@orin) about it.',
			lane: null,
		});
	});
});

describe('parseChatResponse', () => {
	const response = {
		model: 'auto',
		choices: [{ message: { role: 'assistant', content: 'Madrid is sunny.  (@orin)' } }],
		usage: { prompt_tokens: 10, completion_tokens: 5 },
	};

	it('returns the clean answer and the lane', () => {
		expect(parseChatResponse(response, true)).toEqual({
			answer: 'Madrid is sunny.',
			lane: '@orin',
			model: 'auto',
			usage: { prompt_tokens: 10, completion_tokens: 5 },
		});
	});

	it('keeps the signature when asked to', () => {
		expect(parseChatResponse(response, false)).toMatchObject({
			answer: 'Madrid is sunny.  (@orin)',
			lane: '@orin',
		});
	});

	it('survives an empty or odd response', () => {
		expect(parseChatResponse({}, true)).toEqual({
			answer: '',
			lane: null,
			model: null,
			usage: null,
		});
		expect(parseChatResponse('nope', true).answer).toBe('');
	});
});

describe('listing parsers', () => {
	it('reads model IDs', () => {
		expect(parseModels({ data: [{ id: 'auto' }, { id: 'kimi-k3' }, { nope: 1 }] })).toEqual([
			'auto',
			'kimi-k3',
		]);
		expect(parseModels(null)).toEqual([]);
	});

	it('reads flows, naming a flow by its slug when it has no name', () => {
		expect(
			parseFlows({
				flows: [
					{ slug: 'triage', name: 'Lead triage', trigger: 'webhook', boxes: 4 },
					{ slug: 'daily', trigger: { type: 'manual' } },
					{ name: 'no slug' },
				],
			}),
		).toEqual([
			{ slug: 'triage', name: 'Lead triage', trigger: 'webhook' },
			{ slug: 'daily', name: 'daily', trigger: 'manual' },
		]);
	});
});

describe('parseRun', () => {
	const run = {
		id: '20261123101500-a1b2c3',
		status: 'done',
		slug: 'triage',
		trace: [
			{ step: 'trigger', box: 'entrada', output: 'a new lead' },
			{ step: 'agent', box: 'b2', output: 'Category: hot' },
			{ step: 'send', box: 'b3', output: '' },
		],
		outputs: { entrada: 'a new lead', b2: 'Category: hot' },
		key: 'never-returned-anyway',
	};

	it('returns the run ID, the status and the last output', () => {
		expect(parseRun(run)).toEqual({
			runId: '20261123101500-a1b2c3',
			status: 'done',
			finished: true,
			finalOutput: 'Category: hot',
			outputs: { entrada: 'a new lead', b2: 'Category: hot' },
			trace: run.trace,
			flow: 'triage',
		});
	});

	it('marks pending and running runs as unfinished, and dry runs as dry', () => {
		expect(parseRun({ ...run, status: 'pending' }).finished).toBe(false);
		expect(parseRun({ ...run, status: 'running' }).finished).toBe(false);
		expect(parseRun({ ...run, status: 'rejected' }).finished).toBe(true);
		expect(parseRun({ ...run, dry: true }).dry).toBe(true);
	});

	it('has no final output when no step produced one', () => {
		expect(finalOutput([{ step: 'flow', error: 'No existe ese flujo.' }])).toBeNull();
		expect(parseRun({})).toMatchObject({ runId: null, status: null, finished: false });
	});
});

describe('the runner knows a fleet by its 16-character id', () => {
	const full = connectionFrom({ fleetId: '3xAmpLeF1eetXyZ7qrsTuvWxyzABCDEFGHJKLMNPQRST' });
	it('runner paths use the first 16 characters, the chat door keeps the full id', () => {
		expect(flowsRequest(full).url).toBe('https://gw.tibios.ai/runs/3xAmpLeF1eetXyZ7/flows');
		expect(getRunRequest(full, 'r1').url).toBe('https://gw.tibios.ai/runs/3xAmpLeF1eetXyZ7/r1');
		expect(modelsRequest(full).url).toBe(
			'https://gw.tibios.ai/fleet/3xAmpLeF1eetXyZ7qrsTuvWxyzABCDEFGHJKLMNPQRST/v1/models',
		);
	});
});
