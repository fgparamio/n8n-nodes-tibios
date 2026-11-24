import type { INodeProperties } from 'n8n-workflow';

const chat = { show: { resource: ['chat'], operation: ['ask'] } };
const runFlow = { show: { resource: ['flow'], operation: ['run'] } };
const getRun = { show: { resource: ['flow'], operation: ['getRun'] } };
const webhook = { show: { resource: ['flow'], operation: ['triggerWebhook'] } };

export const properties: INodeProperties[] = [
	{
		displayName: 'Resource',
		name: 'resource',
		type: 'options',
		noDataExpression: true,
		options: [
			{ name: 'Chat', value: 'chat' },
			{ name: 'Flow', value: 'flow' },
		],
		default: 'chat',
	},
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['chat'] } },
		options: [
			{
				name: 'Ask the Fleet',
				value: 'ask',
				description: "Send a message to the fleet's models and get the answer",
				action: 'Ask the fleet',
			},
		],
		default: 'ask',
	},
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['flow'] } },
		options: [
			{
				name: 'Get a Run',
				value: 'getRun',
				description: 'Read the current state of a flow run',
				action: 'Get a run',
			},
			{
				name: 'Run',
				value: 'run',
				description: 'Start one of the fleet’s flows as a member',
				action: 'Run a flow',
			},
			{
				name: 'Trigger via Webhook Link',
				value: 'triggerWebhook',
				description: 'Start a flow whose trigger is a webhook, using its secret key',
				action: 'Trigger a flow via its webhook link',
			},
		],
		default: 'run',
	},

	// Chat → Ask the fleet
	{
		displayName: 'Model Name or ID',
		name: 'model',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'getModels' },
		default: 'auto',
		displayOptions: chat,
		description:
			'Who answers. "auto" lets the fleet pick the best member; "@orin" asks one member; a model name asks that model. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
	},
	{
		displayName: 'Prompt',
		name: 'prompt',
		type: 'string',
		typeOptions: { rows: 4 },
		required: true,
		default: '',
		displayOptions: chat,
		description: 'The message for the fleet',
	},
	{
		displayName: 'Search the Web',
		name: 'searchTheWeb',
		type: 'boolean',
		default: false,
		displayOptions: chat,
		description: 'Whether the fleet should search the internet before it answers',
	},
	{
		displayName: 'Strip Lane Signature',
		name: 'stripLaneSignature',
		type: 'boolean',
		default: true,
		displayOptions: chat,
		description:
			'Whether to remove the signature the fleet adds at the end of an answer, such as "(@orin)". The member that answered is still returned in the "lane" field.',
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: chat,
		options: [
			{
				displayName: 'Max Tokens',
				name: 'maxTokens',
				type: 'number',
				typeOptions: { minValue: 1 },
				default: 1024,
				description: 'The longest answer, in tokens',
			},
			{
				displayName: 'System Prompt',
				name: 'systemPrompt',
				type: 'string',
				typeOptions: { rows: 4 },
				default: '',
				description: 'Instructions that shape how the fleet answers',
			},
		],
	},

	// Flow → Run a flow / Trigger via webhook link
	{
		displayName: 'Flow Name or ID',
		name: 'flow',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'getFlows' },
		required: true,
		default: '',
		displayOptions: { show: { resource: ['flow'], operation: ['run', 'triggerWebhook'] } },
		description:
			'The flow to start. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
	},
	{
		displayName: 'Webhook Key',
		name: 'webhookKey',
		type: 'string',
		typeOptions: { password: true },
		required: true,
		default: '',
		displayOptions: webhook,
		description: 'The secret key of the flow’s webhook trigger, shown in TibiOS next to its link',
	},
	{
		displayName: 'Input Text',
		name: 'text',
		type: 'string',
		typeOptions: { rows: 4 },
		required: true,
		default: '',
		displayOptions: { show: { resource: ['flow'], operation: ['run', 'triggerWebhook'] } },
		description: 'The text the flow starts with',
	},
	{
		displayName: 'Dry Run',
		name: 'dry',
		type: 'boolean',
		default: false,
		displayOptions: runFlow,
		description:
			'Whether to test the flow: nothing leaves the fleet and nobody is asked for approval',
	},
	{
		displayName: 'Wait for the Run to Finish',
		name: 'waitForResult',
		type: 'boolean',
		default: true,
		displayOptions: runFlow,
		description:
			'Whether to keep checking the run until it is done, failed or rejected. A run paused for human approval keeps waiting until someone decides in TibiOS or the timeout passes.',
	},
	{
		displayName: 'Check Every (Seconds)',
		name: 'pollInterval',
		type: 'number',
		typeOptions: { minValue: 1 },
		default: 10,
		displayOptions: {
			show: { resource: ['flow'], operation: ['run'], waitForResult: [true] },
		},
		description: 'How often to check the run',
	},
	{
		displayName: 'Timeout (Minutes)',
		name: 'timeout',
		type: 'number',
		typeOptions: { minValue: 1 },
		default: 10,
		displayOptions: {
			show: { resource: ['flow'], operation: ['run'], waitForResult: [true] },
		},
		description:
			'How long to wait at most. When it passes, the node returns the run as it is then, with "timedOut" set to true.',
	},

	// Flow → Get a run
	{
		displayName: 'Run ID',
		name: 'runId',
		type: 'string',
		required: true,
		default: '',
		placeholder: '20261123101500-a1b2c3',
		displayOptions: getRun,
		description: 'The ID of the run, as returned by the "Run" operation',
	},
];
