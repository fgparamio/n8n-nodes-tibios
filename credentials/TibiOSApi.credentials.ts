import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class TibiOSApi implements ICredentialType {
	name = 'tibiOSApi';

	displayName = 'TibiOS API';

	icon = {
		light: 'file:../nodes/Tibios/tibios.svg',
		dark: 'file:../nodes/Tibios/tibios.dark.svg',
	} as const;

	documentationUrl =
		'https://github.com/fgparamio/n8n-nodes-tibios#credentials';

	properties: INodeProperties[] = [
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: 'https://gw.tibios.ai',
			required: true,
			description: 'The TibiOS gateway. Change it only if your fleet runs its own gateway.',
		},
		{
			displayName: 'Fleet ID',
			name: 'fleetId',
			type: 'string',
			default: '',
			required: true,
			placeholder: '3xAmpLeF1eetXyZ7…',
			description:
				'The ID of your fleet, as shown in its link (tibios.ai/localai/fleet/&lt;ID&gt;)',
		},
		{
			displayName: 'Invitation',
			name: 'invitationToken',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description: 'The invitation token a member of the fleet holds',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.invitationToken}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.baseUrl.replace(/\\/+$/, "")}}',
			url: '=/fleet/{{encodeURIComponent($credentials.fleetId.trim())}}/v1/models',
			method: 'GET',
		},
	};
}
