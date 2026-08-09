# Performance Review Framework

## Metric Groups

Use only metrics available through the authorized backend, official API, or user-provided export.

| Group | Examples | Main question |
|-------|----------|---------------|
| Reach | Delivered, exposed, opened, unique readers | Did the topic and distribution reach the intended audience? |
| Consumption | Reads, completion or dwell proxies when available | Did the article hold attention and deliver the promise? |
| Sharing | Shares, forwarding, recommendation signals | Did readers consider it useful enough to pass on? |
| Interaction | Comments, replies, follows, saves when available | What questions, objections, and follow-up needs emerged? |
| Conversion | Source-link visits, approved campaign events | Did the article support its declared action without overclaiming attribution? |
| Quality | Corrections, broken links, rendering defects, support questions | What must be fixed or updated? |

## Normalization

- Compare articles at the same age window when possible.
- Separate topic, format, publication time, distribution, existing audience, and paid support.
- Compare a tutorial to its tutorial goal, not only to a news brief's reach.
- Use medians and ranges before relying on averages when the sample is small.
- Preserve zero and weak results; do not silently remove them from the baseline.

## Inference Rules

State four layers separately:

1. **Observed** - the metric or reader text directly available.
2. **Interpretation** - the editorial pattern consistent with that observation.
3. **Hypothesis** - a possible cause that has not been isolated.
4. **Experiment** - one controlled change and the signal that would support or reject it.

Do not claim that a title, posting time, cover, topic, length, or CTA caused an outcome from a single uncontrolled article.

## Review Windows

- Early check: rendering, broken links, corrections, and strong reader confusion.
- First performance window: use the account's normal reporting delay and article age.
- Series review: compare several related articles after each has a fair observation period.
- Evergreen review: recheck links, versions, pricing, and lifecycle before a scheduled update.

## Experiment Card

```yaml
change: one editorial variable
reason: observation and hypothesis
control: what remains the same
target_articles: []
window: evaluation period
success_signal: measurable or qualitative threshold
failure_signal: what would reject the hypothesis
risk: confounders and unintended effects
```
