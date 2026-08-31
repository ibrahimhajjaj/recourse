# Egyptian Arabic Receipt Extraction: Provider Comparison and Recommendation

**Prepared:** 31 August 2026

## Executive conclusion

For the stated requirement—an angled, glare-prone Egyptian supermarket receipt in Arabic RTL, with item/quantity/price pairing and strict JSON—the best first production choice is **Google Cloud Document AI Expense Parser**, subject to a short acceptance test on representative Egyptian receipts. It is the only option in this review that combines a purpose-built receipt/expense processor, explicit structured document extraction, a simple HTTPS API, and a publicly stated **$0.10 per receipt/document count** price. Its weakness is important: I found no public, receipt-specific Arabic benchmark from Google, so Arabic RTL line-item accuracy must be measured by your own pilot rather than inferred from “200+ languages.”

The named second choice is **Azure AI Document Intelligence prebuilt Receipt**, also subject to a pilot. Microsoft documentation indicates Arabic support in the broader prebuilt/Read language materials, and the receipt model is purpose-built for line items and totals. However, the public pricing page is region/commitment dependent and did not expose a stable numeric rate in the retrieved material, so procurement must confirm the Egypt-serving region price before selection.

If the acceptance test shows that either dedicated parser mis-pairs RTL columns, the practical fallback is a **two-stage pipeline**: Google Cloud Vision or Azure Read for OCR/layout, followed by a paid vision model with strict schema validation and a deterministic Arabic normalization layer. Do not use a free Gemini API tier for household receipts: Google explicitly says unpaid content may be used to improve products and may be reviewed by humans.

> **Recommendation:** pilot Google Document AI Expense Parser and Azure Receipt on 100–200 real, consented Egyptian receipts; measure exact line-item pairing, total reconciliation, Arabic canonicalization, and abstention behavior. Choose the provider only if it meets a pre-agreed field-level threshold. A vendor’s multilingual claim is not evidence of correct RTL receipt-table pairing.

## Decision criteria and assumptions

The calculations below use the requested profile of one 1–2 MP image and 400 output tokens. Image-token billing is provider-specific and often depends on resolution/detail settings, so where a vision model does not publish a simple image rate I use a clearly labeled **2,000 billed image-input-token assumption**. The arithmetic excludes network, storage, retries, tax, and any second-pass correction call. At five receipts/day for 30 days, the current volume is approximately 150 receipts/month.

| Requirement | Decision implication |
|---|---|
| Arabic glyphs plus RTL column relationships | Prefer a receipt/document parser or a VLM proven on Arabic documents; plain OCR is insufficient. |
| Strict JSON | Require native JSON Schema/structured output or validate and retry server-side. Prompt-only JSON is not enough. |
| Household shopping data | Paid API/commercial terms with no training by default; avoid free tiers with human review. |
| $5/month current ceiling | At 150 receipts/month, average allowable cost is **$0.0333/receipt**. Google Document AI Expense Parser at $0.10/receipt would be about **$15/month**, above the ceiling. |
| Future few-hundred/day scale | Dedicated per-page or per-document pricing becomes materially more important than consumer-plan quotas. |

## Cost leaders with exact arithmetic

These are the three lowest-cost **publicly priced building blocks** that can be calculated from the supplied profile. They are not all complete receipt solutions by themselves.

| Rank | Provider/path | Current public rate | Arithmetic for one receipt | Cost/receipt | 150 receipts/month |
|---:|---|---:|---|---:|---:|
| 1 | OpenAI `gpt-4o-mini`, assuming 2,000 image tokens + 400 output tokens | $0.15/M input; $0.60/M output | `(2,000 × $0.15 / 1,000,000) + (400 × $0.60 / 1,000,000)` | **$0.00054** | **$0.081** |
| 2 | Google Cloud Vision Enterprise Document OCR | $1.50/1,000 images in the 1,000–5M band | `1 × $1.50 / 1,000` | **$0.00150** | **$0.225** |
| 3 | Gemini 3.7 Flash paid standard, assuming 2,000 input tokens + 400 output tokens | $0.75/M input + $3.75/M output through 31 Dec 2026 | `(2,000 × $0.75 / 1,000,000) + (400 × $3.75 / 1,000,000)` | **$0.00300** | **$0.450** |

OpenAI’s figure is an estimate because the image must first be converted to provider-billed image tokens using its image-cost calculator; actual cost can differ by model, detail, and resolution. Vision OCR alone does not produce the requested canonicalized receipt JSON. Gemini’s free tier appears cheaper, but it has materially worse data terms: Google says unpaid content may be used to improve products and that human reviewers may read it. Google Cloud Vision likewise returns OCR/layout primitives, not a complete receipt schema, so application-side pairing and validation are required. The dedicated Google Expense Parser is **$0.10/receipt**, or `150 × $0.10 = $15/month`, and therefore fails the hard current budget unless a free allowance, negotiated rate, or a much lower-volume assumption applies. [1] [2] [3] [4]

## Provider-by-provider comparison

### General vision models

| Provider | Arabic/document evidence | Structured output | Cost signal for this profile | Data, residency, and retention | Reliability and verdict |
|---|---|---|---|---|---|
| **OpenAI** | Arabic capability is plausible, and KITAB-Bench reports GPT-4o outperforming traditional OCR on Arabic document tasks, but that is not an Egyptian receipt benchmark. | Native structured outputs/JSON schema are available on supported models; still validate totals and line relationships. | `gpt-4o-mini` estimate **$0.00054/receipt** under the 2,000-image-token assumption; use the official calculator for production. | API data is not used for training by default. OpenAI states abuse-monitoring logs are retained up to 30 days by default; eligible customers can request Zero Data Retention, subject to approval and endpoint limitations. Processing regions and a 10% regional uplift apply only to eligible newer models. [4] | Strong fallback and easy Node HTTPS integration. Not receipt-specialized; requires careful prompt/schema/reconciliation and an Arabic pilot. |
| **Anthropic Claude** | I found no public Arabic receipt benchmark. General vision is not evidence of Arabic RTL supermarket-table accuracy. | Structured outputs/tools with strict schemas are available on supported API features. | API model price was not stably retrievable from the current official page in this review; obtain a live quote before comparing. | Anthropic’s commercial/API page says retained data is never used for training without express permission; conversation content is not retained by default except covered models requiring 30 days. ZDR is available by organization request; consumer plans are not ZDR. [5] | Good privacy posture on commercial API; not selected because Arabic receipt evidence and current profile cost are insufficiently verified. |
| **Google Gemini API** | KITAB-Bench reports Gemini among VLMs outperforming traditional OCR on Arabic documents, but not specifically Egyptian thermal receipts. | Native structured output/JSON schema support exists in the Gemini API. | Gemini 3.7 Flash estimate **$0.00300/receipt** with the stated 2,000+400 token assumption; batch is lower but not appropriate for a latency-sensitive single receipt. [2] | Free/unpaid tier: content used to improve products and human reviewers may read/annotate input/output. Paid tier: prompts, images, and responses are not used to improve products; limited abuse-monitoring logs may exist. Google documents project-level ZDR approval and notes File API/caching/grounding exceptions. [6] | Strong candidate for a pilot if Google Cloud procurement is preferred, but use paid services only. |
| **Mistral** | Mistral OCR is a document OCR product, but I found no public Arabic Egyptian-receipt benchmark. | Mistral APIs may support JSON mode/structured responses depending on model/API; verify exact OCR endpoint schema. | Current OCR pricing was not verified from an official accessible page in this review. | Training/retention terms and residency vary by API tier; obtain the current DPA/terms. | Interesting document-focused option, but too many unverified commercial details for the primary choice. |
| **xAI** | No verified Arabic receipt benchmark found. | Structured output support and vision-model schema guarantees need endpoint/model verification. | Current vision price not verified from an official source in this review. | Retention, human review, and residency not verified from provider-owned terms for this report. | Do not select without a written data-processing answer and Arabic receipt pilot. |

### Chinese providers

| Provider | Arabic/document evidence | Structured output | Cost and data position | Verdict |
|---|---|---|---|---|
| **DeepSeek** | Official docs identify an experimental vision model that accepts images and can read screenshots, but I found no Arabic receipt benchmark. | OpenAI-compatible API; schema enforcement for the vision endpoint must be tested rather than assumed. | Public vision pricing and retention details were not sufficiently verified. Processing under a Chinese provider means the provider’s Chinese entity/jurisdiction and PIPL obligations must be assessed; cross-border transfer from Egypt is a legal/procurement question, not a technical guarantee. | Low-cost experiment only after security review; not recommended for household receipts by default. |
| **Alibaba Qwen-VL / Qwen-OCR** | Official search material explicitly mentions scanned documents, tables, and receipts. Arabic RTL accuracy and line-item benchmark evidence were not verified. | Model/API support varies; do not assume hard JSON schema from an OpenAI-compatible wrapper. | Qwen-OCR is promising for the task, but current region-specific price, retention, residency, and human-review terms must be obtained for the chosen Alibaba Cloud region. PIPL/jurisdiction review required. | Best Chinese technical candidate for a controlled pilot; not production recommendation without terms and Egyptian receipt results. |
| **Zhipu GLM-4V** | No verified Arabic receipt benchmark or official Arabic support evidence found. | Schema support not verified for the vision endpoint. | Current price and data-handling terms not verified; Chinese jurisdiction/PIPL review required. | Do not select without vendor evidence. |
| **Moonshot Kimi** | No verified Arabic receipt benchmark found. | Vision schema guarantees not verified. | Current price, retention, residency, and review terms not verified; Chinese jurisdiction/PIPL review required. | Do not select without vendor evidence. |
| **ByteDance Doubao** | No verified Arabic receipt benchmark found. | Vision schema guarantees not verified. | Current price, retention, residency, and review terms not verified; Chinese jurisdiction/PIPL review required. | Do not select without vendor evidence. |

**PIPL position:** PIPL is China’s personal-information law. It can impose obligations on processing by Chinese personal-information handlers and on cross-border transfers, including security-assessment, certification, or standard-contract routes in applicable cases. The existence of PIPL does not mean an Egyptian household’s receipt is automatically protected to an Egyptian or EU standard, and it does not by itself authorize transfer. Obtain the provider’s entity, processing locations, DPA, subprocessors, retention, and cross-border-transfer mechanism before sending data.

### Dedicated OCR and document APIs

| Provider | Arabic and receipt fit | Structured output | Public cost signal | Data/reliability verdict |
|---|---|---|---|---|
| **Google Cloud Vision** | Arabic text support is documented, but Vision is OCR/layout primitives, not receipt semantics. It will not reliably canonicalize dialect or pair RTL item/price columns without application logic. | JSON response, but not the requested semantic receipt schema. | Enterprise Document OCR **$1.50/1,000 images** in the ordinary band = **$0.00150/image**; first 1,000 counts free. [1] | Excellent low-cost OCR component; use only with a parser/validator. Google Cloud enterprise controls are preferable to free Gemini terms. |
| **Google Document AI Expense Parser** | Purpose-built expense/receipt extraction with fields and line items. Arabic receipt accuracy was not publicly benchmarked in the sources reviewed. | Structured processor output; transform to your exact schema and validate. | **$0.10/count**, where one count covers up to 10 pages; a one-image receipt is $0.10. `150 × $0.10 = $15/month`. [1] | Best semantic fit, but over the $5 ceiling at the stated volume. Limited-access note appears on the pricing page for some pretrained processors; confirm availability. |
| **Azure AI Document Intelligence prebuilt Receipt** | Microsoft’s language documentation indicates Arabic support in the prebuilt/Read family, and Receipt is purpose-built for totals and line items. Exact receipt-model Arabic behavior needs a pilot. | Structured JSON with recognized fields, tables, and relationships; transform to exact schema. | Azure’s official pricing is region/commitment dependent; a stable numeric rate was not exposed in retrieved official material, so exact arithmetic requires an account quote/calculator. | Strong second choice if Azure can confirm Arabic Receipt, Egypt-serving region, and data retention. |
| **AWS Textract AnalyzeExpense** | Textract FAQ lists only English, Spanish, Italian, Portuguese, French, and German as supported languages; Arabic is not supported. [7] | Expense relationships are structured, but Arabic input is disqualifying. | Public per-page prices exist, but cost is irrelevant if Arabic is unsupported. | Explicitly reject for this use case. |
| **Mistral OCR** | Document-focused OCR with layout/markdown/table extraction claims; Arabic receipt evidence not verified. | Structured extraction may be assembled from OCR output; not assumed hard JSON schema. | Current official rate not verified. | Pilot candidate only. |
| **ABBYY** | Enterprise OCR supports many scripts in product families, but I found no public Arabic Egyptian-receipt benchmark or simple self-serve API price. | Strong document classification/extraction products; exact JSON/API behavior depends on product. | Quote-based/enterprise pricing not verified. | Consider only if enterprise support and on-premise/data-residency controls justify procurement. |
| **Nanonets** | Receipt OCR product claims multi-country coverage; Arabic-specific evidence was not verified. | Structured receipt fields/line items are offered; verify hard schema and null/error semantics. | Public pricing and retention were not verified from provider-owned material in this review. | Pilot only; vendor accuracy claims are not independent evidence. |
| **Mindee** | Receipt API is purpose-built and offers a free trial; Arabic support was not verified. | Structured JSON receipt output is a core product feature; exact schema mapping needs testing. | 14-day trial is advertised; production price not verified here. | Worth a small pilot if Arabic support is confirmed in writing. |
| **Veryfi** | Provider language FAQ explicitly lists **Arabic** among supported OCR languages; receipt API returns structured fields including line items, totals, vendors, and currencies. This is provider evidence, not an independent Arabic RTL benchmark. [8] | Structured JSON is a core API output. | Current production price was not verified from a stable public pricing page in this review. | One of the most promising receipt-specific SaaS candidates; obtain retention/residency/DPA and test Egyptian thermal receipts. |
| **Klippa** | Provider material says its OCR supports receipts in Latin-alphabetic languages; that is a warning that Arabic may not be supported by the relevant product. [9] | Structured document extraction available. | Current price not verified. | Treat Arabic as unsupported until Klippa confirms the exact model/locale. |
| **Taggun** | Vendor claims >90% accuracy and broad country coverage, but no independent Arabic receipt benchmark was found. [10] | Receipt API returns structured merchant, total, tax, and line-item fields; hard JSON-schema enforcement was not verified. | Public price not verified. | Candidate for trial, not enough evidence for selection. |

## Open models and self-hosting later

| Model/tool | Arabic status | Practical deployment note | Assessment |
|---|---|---|---|
| **Qwen-VL/Qwen-OCR** | Qwen’s current OCR material explicitly targets documents, tables, and receipts; Arabic accuracy on Egyptian thermal receipts remains unverified. | Small/medium quantized VLMs can fit on roughly 12–24 GB VRAM depending on parameter count and quantization; larger 32B–72B variants require multi-GPU or substantial memory. | Most promising open-model route for a later privacy-preserving pilot. |
| **InternVL** | General multilingual vision-language capability is documented, but Arabic receipt-table accuracy was not verified. | 8B-class quantized models commonly need roughly 12–20 GB VRAM; 26B/40B/78B variants scale to 24–80+ GB depending on quantization/context. | Good research candidate, not a ready receipt parser. |
| **Llama Vision** | Multilingual vision capability does not prove Arabic OCR; no receipt-specific Arabic evidence found. | 11B-class quantized deployment is commonly feasible around 16–24 GB VRAM; larger versions need more. | Use only after a receipt benchmark and custom post-processing. |
| **PaddleOCR** | An Arabic recognition model exists, but PaddleOCR has documented/observed RTL reading-order limitations; glyph recognition is not table understanding. [11] | CPU-friendly and inexpensive; Arabic recognition can run without a large GPU. | Useful OCR front end, but pair columns with geometry and a second parser. |
| **Tesseract with Arabic** | `ara.traineddata` reads Arabic characters. It has no semantic receipt understanding and can fail on glare, thermal print, connected script, and RTL ordering. | CPU-only; practical for preprocessing/ensemble OCR. | Lowest infrastructure cost, lowest confidence as a complete solution. |

## Accuracy evidence: what is and is not established

The strongest independent evidence found was **KITAB-Bench**, an Arabic OCR/document benchmark. Its reported conclusion is that modern VLMs including GPT-4o, Gemini, and Qwen outperform several traditional OCR systems on the benchmark. That supports testing VLMs for Arabic document understanding, but it does **not** establish accuracy on Egyptian supermarket thermal receipts, dialect normalization, or the exact `item → quantity → unit price → line total` association. [12]

There is a categorical difference between reading Arabic glyphs and understanding a receipt layout. A system can transcribe `طماطم` correctly while assigning the price from the neighboring row or the wrong RTL column. Acceptance testing must therefore score field-level extraction and relationships, not only character-level OCR.

## Privacy, retention, residency, and free tiers

| Provider/tier | Training by default | Human review | Retention/control found in official material | Residency/jurisdiction implication |
|---|---|---|---|---|
| OpenAI API paid | No, unless explicitly opted in. | Possible under abuse/safety exceptions; default abuse logs can contain content. | Up to 30 days abuse-monitoring logs by default; eligible customers may request ZDR/Modified Abuse Monitoring. [4] | Select supported processing region if eligible; regional processing may add 10%. |
| Anthropic API commercial | Not used for training without express permission. | Not stated as a routine default in the extracted commercial retention page; request contract language. | Conversation content not retained by default except covered models with 30-day requirement; ZDR by organization request. [5] | First-party API vs AWS/Google partner processing differs; partner cloud is the data processor. |
| Gemini API unpaid/free | Used to improve/develop products. | Google says human reviewers may read, annotate, and process API inputs/outputs. [6] | Do not submit sensitive/confidential/personal information. | Avoid for household receipts. |
| Gemini API paid | Not used to improve products. | Limited safety/abuse logging; ZDR can be approved at project level with feature exceptions. [6] | Grounding stores data 30 days and cannot be disabled; File API stores until deletion/expiry; caching adds storage. [6] | Logs/cache may be stored in countries where Google or agents operate unless the applicable Cloud control says otherwise. |
| Google Cloud Vision/Document AI | Enterprise cloud terms, not Gemini free-tier terms; verify project DPA and region. | Verify contractual controls. | Prefer enterprise project controls; exact retention depends on product/settings. | Choose a supported processing region and confirm Egypt transfer posture. |
| Azure/AWS/receipt SaaS/Chinese APIs | Not sufficiently verified for every tier in this review. | Not sufficiently verified. | Must obtain DPA, retention schedule, subprocessor list, deletion SLA, and free-tier terms before production. | Chinese vendors require a PIPL/cross-border transfer review; SaaS vendors may process in US/EU/other regions. |

## Reliability and API stability

All listed providers have established public APIs or products, but “stable” is not the same as “accurate.” In this review I did not find a comparable, independently auditable multi-year outage dataset for every provider. Status-page availability history should be checked immediately before procurement and monitored in production. The operational design should include a 10-second timeout, idempotent receipt IDs, exponential backoff for transient 429/5xx responses, a dead-letter queue, image hashing to prevent duplicate charges, and a reconciliation rule that rejects output when `sum(line_total)` differs from the grand total beyond a small currency tolerance.

For the first pilot, log provider/model/version, latency, HTTP status, parse failures, schema-validation failures, total mismatch, and a human-corrected gold label. Never log raw receipts or Arabic text unless the household has consented and the retention policy permits it.

## Final recommendation

**Primary choice: Google Cloud Document AI Expense Parser.** It best matches the semantic problem—receipt fields and line items rather than bare OCR—and has a simple, explicit per-receipt price. The economic objection is decisive at the stated current volume: approximately **$15/month**, three times the $5 ceiling. Select it only if the hard budget can be relaxed, the actual volume is much lower, or Google grants a suitable allowance/discount. Its Arabic evidence is insufficient without a pilot.

**Second choice: Azure AI Document Intelligence prebuilt Receipt.** It is the closest like-for-like alternative and may fit the budget better depending on the region and negotiated/portal price. Require Microsoft to confirm that the exact Receipt model—not merely the general Read OCR model—supports Arabic text and the required line-item relationships, and require a written answer on processing region, retention, human review, and free-tier terms.

**Cost-constrained fallback: OpenAI `gpt-4o-mini` with strict schema plus a deterministic validator and Arabic normalization table.** Under the stated 2,000 image-token assumption, the model call is about **$0.00054/receipt**, but this is only an estimate and not a receipt-specific accuracy guarantee. It is attractive for a prototype because it supports image input, structured outputs, and plain HTTPS. Keep a provider-independent post-processor that rejects non-reconciling totals and routes uncertain receipts to human review.

Do not ship AWS Textract for this use case because the official FAQ’s supported-language list excludes Arabic. Do not ship a free Gemini tier because its own terms permit product improvement use and human review. Do not select a Chinese provider solely because of low token pricing; first obtain the entity, region, PIPL/cross-border mechanism, training and review policy, retention schedule, and an Arabic RTL receipt benchmark.

## References

[1]: https://cloud.google.com/products/document-ai/pricing "Google Cloud Document AI pricing"
[2]: https://ai.google.dev/gemini-api/docs/pricing "Gemini API pricing"
[3]: https://developers.openai.com/api/docs/pricing "OpenAI API pricing"
[4]: https://developers.openai.com/api/docs/guides/your-data "OpenAI API data controls"
[5]: https://platform.claude.com/docs/en/manage-claude/api-and-data-retention "Anthropic API and data retention"
[6]: https://ai.google.dev/gemini-api/terms "Gemini API Additional Terms of Service"
[7]: https://aws.amazon.com/textract/faqs/ "Amazon Textract FAQs"
[8]: https://faq.veryfi.com/en/articles/5415075-languages-supported-by-veryfi-ocr-api "Veryfi OCR supported languages"
[9]: https://www.klippa.com/en/ocr/financial-documents/receipts/ "Klippa receipt OCR"
[10]: https://www.taggun.io/product "Taggun receipt OCR product"
[11]: https://github.com/PaddlePaddle/PaddleOCR/discussions/14971 "PaddleOCR discussion on Arabic RTL reading order"
[12]: https://arxiv.org/html/2502.14949v2 "KITAB-Bench: A Comprehensive Multi-Domain Benchmark for Arabic OCR and Document Understanding"
