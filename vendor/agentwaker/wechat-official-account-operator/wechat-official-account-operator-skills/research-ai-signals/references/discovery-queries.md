# Discovery Query Pack

Verify account handles, API syntax, access tiers, and search windows before every automated run.

## GitHub REST Search

Replace the date with the active window:

```text
topic:ai-agent pushed:>=YYYY-MM-DD stars:>30
topic:coding-agent pushed:>=YYYY-MM-DD
topic:mcp-server created:>=YYYY-MM-DD
"vibe coding" in:name,description,readme pushed:>=YYYY-MM-DD
"AI coding" in:name,description,readme pushed:>=YYYY-MM-DD
```

Snapshot stars, forks, contributors, releases, commits, issues, and pull requests at consistent intervals. Total stars are not a growth rate. Read Search-specific rate-limit response headers.

## X Official API

Start with two private editorial Lists and verify each account through its organization or personal site.

Institution and product candidates:

```text
@OpenAI @OpenAIDevs @AnthropicAI @GoogleDeepMind @huggingface
@GitHub @GitHubNext @cursor_ai @LangChainAI
```

Practitioner candidates:

```text
@karpathy @simonw @swyx
```

Official-source query:

```text
(from:OpenAI OR from:OpenAIDevs OR from:AnthropicAI OR
 from:GoogleDeepMind OR from:huggingface OR from:GitHub OR
 from:cursor_ai)
(agent OR coding OR MCP OR model OR release)
-is:reply -is:retweet
```

Project discovery query:

```text
(url:github.com OR url:huggingface.co OR url:arxiv.org)
("coding agent" OR "vibe coding" OR MCP)
lang:en -is:retweet -is:reply
```

Use only the official API for automation. Store the minimum Post ID, author ID, time, external URL, and required metrics. Return every material claim to a durable primary source.

## Hacker News

Use the official Firebase API lists:

- `topstories.json`
- `beststories.json`
- `showstories.json`
- `item/{id}.json`

An initial editorial filter can use 24 hours plus `score >= 30` or `comments >= 15`; for Show HN, test `score >= 15`. These are triage thresholds, not quality conclusions.

## Reddit

Keep the standing set small:

- `r/LocalLLaMA`
- `r/MachineLearning`

Add a product community temporarily only when researching that product. Use OAuth, a unique User-Agent, response-header rate limits, and deletion synchronization.

## Papers

Apply title and abstract filters to arXiv, ACL Anthology, OpenReview, and paper recommendations:

```text
agent
tool use
computer use
coding agent
code generation
software engineering
repository-level
long-horizon
MCP
benchmark
verification
self-correction
multi-agent
```

Down-rank benchmark claims that lack code, data, evaluation detail, or a meaningful baseline.

## Chinese Reader-demand Queries

Combine the project name with:

```text
installation, China access, Chinese documentation, pricing, privacy,
source code, deployment, alternative, comparison, failure, tutorial,
API, model support, context cost, prompt injection, sandbox
```

Use Chinese media and communities to learn reader wording and missing explanations. Verify technical claims through the canonical project.

## Telegram

Do not define public-channel scraping queries. Use a Bot only to deliver the already selected candidate queue to a user-owned or explicitly consented editorial channel.
