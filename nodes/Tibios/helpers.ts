import type { IDataObject, IHttpRequestMethods, IHttpRequestOptions } from 'n8n-workflow';

/** The prefix that makes the fleet search the web before it answers. */
export const SEARCH_THE_WEB_PREFIX = 'Busca en internet ';

/** A chat or flow call may wait on a slow member; five minutes is the ceiling. */
export const REQUEST_TIMEOUT_MS = 300_000;

/** Statuses after which a run never changes again on its own. */
const UNFINISHED = new Set(['running', 'pending']);

/**
 * The lane signature the fleet's router appends to an answer: "  (@orin)" or "— @orin",
 * possibly repeated. Mirrors the router's own pattern.
 */
const LANE_SIGNATURE = /(?:\s*(?:—\s*@\w+|\(@\w+\)))+\s*$/;
const LANE_NAME = /@(\w+)\)?\s*$/;

export interface TibiOSConnection {
	baseUrl: string;
	fleetId: string;
}

export interface ChatInput {
	model: string;
	prompt: string;
	systemPrompt?: string;
	searchTheWeb?: boolean;
	maxTokens?: number;
}

export interface ChatResult extends IDataObject {
	answer: string;
	lane: string | null;
	model: string | null;
	usage: IDataObject | null;
}

export interface FlowRunResult extends IDataObject {
	runId: string | null;
	status: string | null;
	finished: boolean;
	finalOutput: string | null;
	outputs: IDataObject;
	trace: IDataObject[];
}

export function connectionFrom(credentials: IDataObject): TibiOSConnection {
	const baseUrl = String(credentials.baseUrl ?? '')
		.trim()
		.replace(/\/+$/, '');
	const fleetId = String(credentials.fleetId ?? '').trim();
	return { baseUrl: baseUrl || 'https://gw.tibios.ai', fleetId };
}

function fleetPath(connection: TibiOSConnection): string {
	return encodeURIComponent(connection.fleetId);
}

/** The runner files a fleet under the first 16 characters of its id. */
function runnerPath(connection: TibiOSConnection): string {
	return encodeURIComponent(connection.fleetId.slice(0, 16));
}

function request(
	method: IHttpRequestMethods,
	url: string,
	body?: IDataObject,
	headers?: IDataObject,
): IHttpRequestOptions {
	const options: IHttpRequestOptions = { method, url, json: true, timeout: REQUEST_TIMEOUT_MS };
	if (body !== undefined) options.body = body;
	if (headers !== undefined) options.headers = headers;
	return options;
}

export function modelsRequest(connection: TibiOSConnection): IHttpRequestOptions {
	return request('GET', `${connection.baseUrl}/fleet/${fleetPath(connection)}/v1/models`);
}

export function chatRequest(connection: TibiOSConnection, input: ChatInput): IHttpRequestOptions {
	const messages: IDataObject[] = [];
	const system = input.systemPrompt?.trim();
	if (system) messages.push({ role: 'system', content: system });
	const prompt = input.prompt.trim();
	messages.push({
		role: 'user',
		content: input.searchTheWeb ? `${SEARCH_THE_WEB_PREFIX}${prompt}` : prompt,
	});
	const body: IDataObject = { model: input.model.trim() || 'auto', messages };
	if (input.maxTokens !== undefined && input.maxTokens > 0) body.max_tokens = input.maxTokens;
	return request(
		'POST',
		`${connection.baseUrl}/fleet/${fleetPath(connection)}/v1/chat/completions`,
		body,
	);
}

export function flowsRequest(connection: TibiOSConnection): IHttpRequestOptions {
	return request('GET', `${connection.baseUrl}/runs/${runnerPath(connection)}/flows`);
}

export function runFlowRequest(
	connection: TibiOSConnection,
	slug: string,
	text: string,
	dry: boolean,
): IHttpRequestOptions {
	const body: IDataObject = { text, from: 'n8n' };
	if (dry) body.dry = true;
	return request(
		'POST',
		`${connection.baseUrl}/runs/${runnerPath(connection)}/flows/${encodeURIComponent(slug)}/run`,
		body,
	);
}

export function getRunRequest(connection: TibiOSConnection, runId: string): IHttpRequestOptions {
	return request(
		'GET',
		`${connection.baseUrl}/runs/${runnerPath(connection)}/${encodeURIComponent(runId)}`,
	);
}

export function webhookRequest(
	connection: TibiOSConnection,
	slug: string,
	key: string,
	text: string,
): IHttpRequestOptions {
	return request(
		'POST',
		`${connection.baseUrl}/runs/${runnerPath(connection)}/flows/${encodeURIComponent(slug)}/hook`,
		{ text },
		{ 'X-Flow-Key': key },
	);
}

/** The answer without the router's lane signature, and the lane it named ("@orin"). */
export function splitLaneSignature(text: string): { answer: string; lane: string | null } {
	const match = LANE_SIGNATURE.exec(text);
	if (!match) return { answer: text, lane: null };
	const name = LANE_NAME.exec(match[0]);
	return { answer: text.slice(0, match.index).trimEnd(), lane: name ? `@${name[1]}` : null };
}

function asObject(value: unknown): IDataObject {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? (value as IDataObject)
		: {};
}

export function parseChatResponse(response: unknown, stripLaneSignature: boolean): ChatResult {
	const body = asObject(response);
	const choices = Array.isArray(body.choices) ? body.choices : [];
	const message = asObject(asObject(choices[0]).message);
	const content = typeof message.content === 'string' ? message.content : '';
	const { answer, lane } = splitLaneSignature(content);
	return {
		answer: stripLaneSignature ? answer : content,
		lane,
		model: typeof body.model === 'string' ? body.model : null,
		usage: body.usage ? asObject(body.usage) : null,
	};
}

export function parseModels(response: unknown): string[] {
	const data = asObject(response).data;
	if (!Array.isArray(data)) return [];
	return data
		.map((entry) => asObject(entry).id)
		.filter((id): id is string => typeof id === 'string' && id.length > 0);
}

export interface FlowSummary {
	slug: string;
	name: string;
	trigger: string;
}

export function parseFlows(response: unknown): FlowSummary[] {
	const flows = asObject(response).flows;
	if (!Array.isArray(flows)) return [];
	const summaries: FlowSummary[] = [];
	for (const entry of flows) {
		const flow = asObject(entry);
		if (typeof flow.slug !== 'string' || !flow.slug) continue;
		const trigger = asObject(flow.trigger);
		summaries.push({
			slug: flow.slug,
			name: typeof flow.name === 'string' && flow.name ? flow.name : flow.slug,
			trigger:
				typeof flow.trigger === 'string'
					? flow.trigger
					: typeof trigger.type === 'string'
						? trigger.type
						: '',
		});
	}
	return summaries;
}

export function isFinished(status: string | null): boolean {
	return status !== null && !UNFINISHED.has(status);
}

/** The text of the last trace step that produced one: what the flow ended with. */
export function finalOutput(trace: IDataObject[]): string | null {
	for (let i = trace.length - 1; i >= 0; i--) {
		const output = trace[i].output;
		if (typeof output === 'string' && output.trim()) return output;
	}
	return null;
}

export function parseRun(response: unknown): FlowRunResult {
	const run = asObject(response);
	const trace = Array.isArray(run.trace) ? run.trace.map(asObject) : [];
	const status = typeof run.status === 'string' ? run.status : null;
	const result: FlowRunResult = {
		runId: typeof run.id === 'string' ? run.id : null,
		status,
		finished: isFinished(status),
		finalOutput: finalOutput(trace),
		outputs: asObject(run.outputs),
		trace,
	};
	const flow = typeof run.slug === 'string' ? run.slug : run.workflow;
	if (typeof flow === 'string') result.flow = flow;
	if (run.dry === true) result.dry = true;
	return result;
}
