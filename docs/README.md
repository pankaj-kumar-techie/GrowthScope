# ARMA Audit Engine — Documentation

> Technical documentation for the ARMA Audit Engine & GrowthScope API.

## Documents

| File | What it covers |
|---|---|
| [system-overview.md](./system-overview.md) | Full system diagram — all APIs, data flow, inputs/outputs |
| [lite-checker.md](./lite-checker.md) | Lite Checker: step-by-step data flow + API calls |
| [full-checker.md](./full-checker.md) | Full Checker: step-by-step data flow + API calls |
| [api-reference.md](./api-reference.md) | Endpoints, request format, response format, examples |

## Quick Answer: Maryna's Questions

| Question | Answer |
|---|---|
| How is it triggered? | HTTP POST to a REST API endpoint |
| Output format? | PDF (default) or JSON (`?format=json`) |
| Includes competitor data? | Yes — name, position, rating, review count |
| Can PDF be retrieved programmatically? | Yes — API returns the PDF file directly in the response |
| Input required? | `url`, `city`, `state` (+ optional `vertical`) |
| Throughput? | Sequential; Lite ~38 sec, Full 1–2 min per lead (verified) |
| Cost per run? | DataForSEO + Google APIs + Claude API per lead |

Full details in each document below.
