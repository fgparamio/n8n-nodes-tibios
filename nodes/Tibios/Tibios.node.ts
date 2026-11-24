import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError, sleep } from 'n8n-workflow';

import { properties } from './description';
import {
	chatRequest,
	connectionFrom,
	flowsRequest,
	getRunRequest,
	modelsRequest,
	parseChatResponse,
	parseFlows,
	parseModels,
	parseRun,
	runFlowRequest,
	webhookRequest,
	type FlowRunResult,
	type TibiOSConnection,
} from './helpers';

const CREDENTIAL = 'tibiOSApi';

type Context = IExecuteFunctions | ILoadOptionsFunctions;

async function connection(context: Context): Promise<TibiOSConnection> {
	const found = connectionFrom(await context.getCredentials(CREDENTIAL));
	if (!found.fleetId) {
		throw new NodeOperationError(context.getNode(), 'The TibiOS credential has no fleet ID');
	}
	return found;
}

async function call(context: Context, options: IHttpRequestOptions): Promise<unknown> {
	return await context.helpers.httpRequestWithAuthentication.call(context, CREDENTIAL, options);
}

/** A webhook link carries its own key and never the member's invitation. */
async function callWithoutInvitation(
	context: IExecuteFunctions,
	options: IHttpRequestOptions,
): Promise<unknown> {
	return await context.helpers.httpRequest(options);
}

async function waitForRun(
	context: IExecuteFunctions,
	where: TibiOSConnection,
	first: FlowRunResult,
	intervalSeconds: number,
	timeoutMinutes: number,
): Promise<FlowRunResult> {
	let run = first;
	const deadline = Date.now() + timeoutMinutes * 60_000;
	while (!run.finished && run.runId) {
		const left = deadline - Date.now();
		if (left <= 0) return { ...run, timedOut: true };
		await sleep(Math.min(intervalSeconds * 1000, left));
		run = parseRun(await call(context, getRunRequest(where, run.runId)));
	}
	return run;
}

async function executeOne(context: IExecuteFunctions, i: number): Promise<IDataObject> {
	const resource = context.getNodeParameter('resource', i) as string;
	const operation = context.getNodeParameter('operation', i) as string;
	const where = await connection(context);

	if (resource === 'chat' && operation === 'ask') {
		const options = context.getNodeParameter('options', i, {}) as IDataObject;
		const request = chatRequest(where, {
			model: context.getNodeParameter('model', i, 'auto') as string,
			prompt: context.getNodeParameter('prompt', i) as string,
			searchTheWeb: context.getNodeParameter('searchTheWeb', i, false) as boolean,
			systemPrompt: options.systemPrompt as string | undefined,
			maxTokens: options.maxTokens as number | undefined,
		});
		const strip = context.getNodeParameter('stripLaneSignature', i, true) as boolean;
		return parseChatResponse(await call(context, request), strip);
	}

	if (resource === 'flow' && operation === 'run') {
		const request = runFlowRequest(
			where,
			context.getNodeParameter('flow', i) as string,
			context.getNodeParameter('text', i) as string,
			context.getNodeParameter('dry', i, false) as boolean,
		);
		const run = parseRun(await call(context, request));
		if (!(context.getNodeParameter('waitForResult', i, true) as boolean)) return run;
		return await waitForRun(
			context,
			where,
			run,
			context.getNodeParameter('pollInterval', i, 10) as number,
			context.getNodeParameter('timeout', i, 10) as number,
		);
	}

	if (resource === 'flow' && operation === 'getRun') {
		const runId = (context.getNodeParameter('runId', i) as string).trim();
		return parseRun(await call(context, getRunRequest(where, runId)));
	}

	if (resource === 'flow' && operation === 'triggerWebhook') {
		const request = webhookRequest(
			where,
			context.getNodeParameter('flow', i) as string,
			context.getNodeParameter('webhookKey', i) as string,
			context.getNodeParameter('text', i) as string,
		);
		const answer = await callWithoutInvitation(context, request);
		const run = parseRun(answer);
		return run.runId ? run : { response: (answer ?? null) as IDataObject };
	}

	throw new NodeOperationError(
		context.getNode(),
		`The operation "${operation}" is not supported for "${resource}"`,
		{ itemIndex: i },
	);
}

export class Tibios implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'TibiOS',
		name: 'tibios',
		icon: { light: 'file:tibios.svg', dark: 'file:tibios.dark.svg' },
		group: ['transform'],
		version: [1],
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Ask a TibiOS fleet and run its flows',
		defaults: {
			name: 'TibiOS',
		},
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: CREDENTIAL,
				required: true,
			},
		],
		properties,
	};

	methods = {
		loadOptions: {
			async getModels(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const models = parseModels(await call(this, modelsRequest(await connection(this))));
				const names = ['auto', ...models.filter((id) => id !== 'auto')];
				return names.map((id) => ({
					name: id,
					value: id,
					description: id === 'auto' ? 'The fleet picks the best member' : undefined,
				}));
			},

			async getFlows(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const flows = parseFlows(await call(this, flowsRequest(await connection(this))));
				return flows.map((flow) => ({
					name: flow.name,
					value: flow.slug,
					description: flow.trigger ? `Trigger: ${flow.trigger}` : undefined,
				}));
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				returnData.push({ json: await executeOne(this, i), pairedItem: { item: i } });
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: (error as Error).message },
						pairedItem: { item: i },
					});
					continue;
				}
				if (error instanceof NodeOperationError) {
					throw new NodeOperationError(this.getNode(), error, { itemIndex: i });
				}
				throw new NodeApiError(this.getNode(), error as JsonObject, { itemIndex: i });
			}
		}

		return [returnData];
	}
}
