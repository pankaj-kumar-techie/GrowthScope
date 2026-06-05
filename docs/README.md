# ARMA Audit Engine — Documentation

```mermaid
%%{init: {"theme": "base", "themeVariables": {"fontSize": "13px", "lineColor": "#64748B", "clusterBkg": "#F8FAFC"}}}%%
flowchart LR
    classDef google fill:#DBEAFE,color:#1D4ED8,stroke:#93C5FD,stroke-width:2px
    classDef dfs    fill:#FFEDD5,color:#C2530A,stroke:#FED7AA,stroke-width:2px
    classDef ai     fill:#EDE9FE,color:#6D28D9,stroke:#DDD6FE,stroke-width:2px
    classDef sys    fill:#D1FAE5,color:#065F46,stroke:#6EE7B7,stroke-width:2px
    classDef out    fill:#FEF3C7,color:#92400E,stroke:#FCD34D,stroke-width:2px
    classDef inp    fill:#1E293B,color:#F1F5F9,stroke:#475569,stroke-width:2px

    IN1[/"POST /lite-report\n~38 sec"/]:::inp
    IN2[/"POST /full-report\n1–2 min"/]:::inp
    G["Google APIs\nPlaces · PageSpeed"]:::google
    D["DataForSEO\nMaps · Reviews · Traffic"]:::dfs
    A["Claude AI\nHaiku + Sonnet"]:::ai
    P["Puppeteer\nCrawl + Screenshots"]:::sys
    O1[/"Lite PDF or JSON\n1-page brief"/]:::out
    O2[/"6-Page Audit PDF\nFull report"/]:::out

    IN1 --> G & D & A --> O1
    IN2 --> G & D & P & A --> O2
```

## Documents

| File | What it covers |
|---|---|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | **5 Mermaid diagrams** — system overview, execution timeline, Lite flow, Full flow, output structure |
| [system-overview.md](./system-overview.md) | System overview + Lite + Full diagrams with prose explanation |
| [lite-checker.md](./lite-checker.md) | Lite Checker flow + competitor selection logic + JSON field reference |
| [full-checker.md](./full-checker.md) | Full Checker flow + 11 crawl booleans + Claude screenshot logic |
| [api-reference.md](./api-reference.md) | Endpoints · request/response format · code examples · timing |

## Key Facts

| | |
|---|---|
| Trigger | HTTP REST API — `POST /lite-report` or `POST /full-report` |
| Input | `url` + `city` + `state` (+ optional `vertical`) |
| Output | PDF binary in response, or JSON with `?format=json` |
| Lite time | **~38 sec** per lead (verified) |
| Full time | **1–2 min** per lead |
| Competitor data | Yes — name · position · rating · reviews · phone · domain |
| Data sources | Google Places · DataForSEO · Google PageSpeed · Claude AI · Puppeteer |
