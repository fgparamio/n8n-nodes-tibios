# n8n-nodes-tibios

Use a [TibiOS](https://tibios.ai) fleet from your n8n workflows. A fleet is a group of machines
that run open AI models together. With this node you can:

- **ask the fleet** a question and get the answer back, like any chat model;
- **run a TibiOS flow** (the fleet's own automation canvas) and get its result;
- **read a run** later, or start a flow through its **webhook link**.

[n8n](https://n8n.io/) is a workflow automation platform.

- [Installation](#installation)
- [Credentials](#credentials)
- [Operations](#operations)
- [Approvals](#approvals)
- [Example workflows](#example-workflows)
- [Compatibility](#compatibility)
- [Development](#development)

## Installation

In n8n, go to **Settings → Community Nodes → Install**, enter `n8n-nodes-tibios` and confirm.
The **TibiOS** node then appears in the nodes panel.

Self-hosted n8n without the UI installer: follow the
[community nodes installation guide](https://docs.n8n.io/integrations/community-nodes/installation/).
Install into `~/.n8n/nodes` and pass `--omit=peer`, then restart n8n:

```sh
cd ~/.n8n/nodes            # inside the n8n container: /home/node/.n8n/nodes
npm install --omit=peer n8n-nodes-tibios      # or a packed tarball: ./n8n-nodes-tibios-0.1.0.tgz
```

Without `--omit=peer`, npm also installs the `n8n-workflow` peer, which pulls `isolated-vm` and
fails to compile inside the official n8n image. n8n already provides `n8n-workflow` at runtime.

## Credentials

Create a **TibiOS API** credential with three fields:

| Field | What to put there |
|---|---|
| **Base URL** | `https://gw.tibios.ai`. Change it only if your fleet runs its own gateway. |
| **Fleet ID** | The ID in your fleet's link: `https://tibios.ai/localai/fleet/<fleet ID>#<code>`. It looks like `3xAmpLeF1eetXyZ7…`. |
| **Invitation** | The full invitation of a member of the fleet (a long token). |

Where to get the invitation: the fleet's link ends in a short code (`#Ab3dEf9h`). The gateway
turns that code into the full invitation:

```sh
curl -s https://gw.tibios.ai/fleet/<fleet ID>/invite/<code>
# {"invite": "…the invitation…"}
```

Copy the `invite` value into the credential. Whoever administers the fleet can also hand you
an invitation directly. Treat it like a password: anyone holding it can use the fleet.

When you save, n8n tests the credential by listing the fleet's models
(`GET /fleet/<fleet ID>/v1/models`). A green check means the fleet accepted the invitation.

## Operations

### Chat → Ask the Fleet

Sends one message to the fleet (OpenAI-compatible chat completions) and returns the answer.

| Parameter | Description |
|---|---|
| Model | `auto` (the fleet picks the best member), a member such as `@orin`, or a model such as `kimi-k3`. The list is loaded from the fleet. |
| Prompt | The message. |
| Search the Web | The fleet searches the internet before answering. |
| Strip Lane Signature | On by default. The fleet signs each answer with the member that wrote it, such as `(@orin)`; this removes it from `answer`. |
| Options → System Prompt | Instructions that shape the answer. |
| Options → Max Tokens | The longest answer. |

Output:

```json
{ "answer": "Madrid is sunny today.", "lane": "@orin", "model": "auto", "usage": null }
```

`lane` is the member that answered, whether or not the signature was stripped.

### Flow → Run

Starts one of the fleet's flows as a member (the run says it came `from: "n8n"`).

| Parameter | Description |
|---|---|
| Flow | The flow, from a list loaded from the fleet. |
| Input Text | The text the flow starts with. |
| Dry Run | A test: nothing leaves the fleet and nobody is asked for approval. |
| Wait for the Run to Finish | On by default. The node checks the run until it is `done`, `failed` or `rejected`. |
| Check Every (Seconds) | Default 10. |
| Timeout (Minutes) | Default 10. When it passes, the node returns the run as it is, with `timedOut: true`. |

Output:

```json
{
  "runId": "20261123101500-a1b2c3",
  "status": "done",
  "finished": true,
  "finalOutput": "Category: hot lead",
  "outputs": { "entrada": "…", "n2": "Category: hot lead" },
  "trace": [{ "step": "agent", "box": "n2", "output": "Category: hot lead" }],
  "flow": "lead-triage"
}
```

`finalOutput` is the text of the last step that produced one. `outputs` holds each box's text by
box ID. `status` is one of `running`, `pending` (waiting for a person), `done`, `failed` or
`rejected`.

### Flow → Get a Run

Reads a run by its ID (`runId` from **Run**) and returns the same shape, at once.

### Flow → Trigger via Webhook Link

Starts a flow whose trigger is a webhook, with the flow's secret key (sent as `X-Flow-Key`) and
the input text. The invitation is **not** sent on this call. The output is the run when the
fleet returns one, otherwise `{ "response": … }` with what the fleet answered.

## Approvals

A flow that sends something out (to Telegram, Slack or a web address) stops before the send and
waits for a person of the fleet to approve it in TibiOS. The run is then `pending`.

The node **never approves**. It can only wait:

- With **Wait for the Run to Finish** on, the node keeps checking until someone approves or
  rejects, or until the timeout. The n8n execution stays open meanwhile, so keep the timeout
  reasonable.
- With it off, the node returns the `pending` run at once. Read it later with **Get a Run**,
  for example after a *Wait* node, or let the flow call n8n back (example 3).

A **Dry Run** never pauses: nothing is sent and nobody is asked.

## Example workflows

Ready-to-import workflows live in [`examples/`](examples/). In n8n, open a new workflow, choose
**⋯ → Import from File**, then pick your **TibiOS API** credential on each TibiOS node (the files
carry no credentials):

| File | What it does |
|---|---|
| [`ask-the-fleet.json`](examples/ask-the-fleet.json) | Manual trigger → *Ask the Fleet*, once plain and once with *Search the Web*. |
| [`run-flow-and-get-run.json`](examples/run-flow-and-get-run.json) | Manual trigger → *Flow → Run* (dry run, waits) → *Get a Run* with `{{ $json.runId }}`. Change the flow `flujo-nuevo` to one of yours. |
| [`receive-tibios-webhook.json`](examples/receive-tibios-webhook.json) | Webhook `POST /webhook/tibios-run` → *Get a Run* with `{{ $json.body.run_id }}`: example 3 below. |

These three were run end to end against a live fleet on a self-hosted n8n 2.47.3.

### 1. Ask the fleet from a form

1. **n8n Form Trigger** with one field, `Question`.
2. **TibiOS** → *Chat → Ask the Fleet*, Model `auto`, Prompt `{{ $json.Question }}`.
   Turn on *Search the Web* for questions about current events.
3. **Form Ending** (or *Respond to Webhook*) showing `{{ $json.answer }}`.

### 2. Run a TibiOS flow and post the result to Slack

1. **Schedule Trigger** (every morning) or any other trigger.
2. **TibiOS** → *Flow → Run*, Flow `daily-summary`, Input Text `Today's leads`,
   *Wait for the Run to Finish* on.
3. **IF** `{{ $json.status }}` equals `done`.
4. **Slack** → *Send a message*, Text `{{ $json.finalOutput }}`. On the false branch, post
   `Run {{ $json.runId }} ended as {{ $json.status }}`.

### 3. A TibiOS flow calls an n8n Webhook node

In a TibiOS flow, an **Enviar** box with *Enviar a → una dirección web* POSTs JSON to a URL once a
person approves it. Point it at n8n:

1. In n8n add a **Webhook** node, method `POST`, and copy its **production** URL. It must be a
   public `https://` address: TibiOS refuses private-network addresses and does not follow
   redirects. Activate the workflow.
2. In TibiOS, paste that URL into the box's *Dirección web*.
3. When the box runs (and is approved), n8n receives:

```json
{
  "run_id": "20261123101500-a1b2c3",
  "fleet": "3xAmpLeF1eetXyZ7…",
  "flow": "lead-triage",
  "text": "Category: hot lead"
}
```

Use `{{ $json.body.text }}` in the next nodes. To fetch the whole run, add a **TibiOS** node →
*Flow → Get a Run* with Run ID `{{ $json.body.run_id }}`. TibiOS waits up to 20 seconds and
treats any answer outside 2xx as a failed send, so reply quickly (the Webhook node's default
*Immediately* response is fine).

## Compatibility

Built with `@n8n/node-cli` 0.56.1 against `n8n-workflow` 2.47 (n8n 2.x). Uses no runtime
dependencies. Verified end to end on self-hosted n8n 2.47.3 (Docker image `n8nio/n8n:2.47.3`).

## Development

```sh
npm install
npm run build     # compiles to dist/
npm run lint      # n8n's community-node rules
npm test          # vitest unit tests
npm run dev       # starts a local n8n with this node, hot reload
```

## Resources

- [TibiOS](https://tibios.ai) and its [API reference](https://tibios.ai/localai/api)
- [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)
