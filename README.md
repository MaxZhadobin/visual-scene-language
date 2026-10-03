# Visual Scene Language (VSL) SDK

Visual Scene Language (VSL) is a JSON-based format and TypeScript SDK for AI agents that interact with screen content. It provides a structured, semantic representation of visual scenes — replacing raw pixel screenshots with compact, machine-readable JSON that language models can interpret directly.

VSL is not a UI application or a rendering engine. It is an infrastructure layer (middleware) that sits between the screen and the LLM, enabling computer use agents to understand, navigate, and act on visual interfaces through semantic structure rather than pixel analysis.

---

## How It Works

Instead of sending full-page screenshots (1-2 MB) to an LLM on every interaction cycle, VSL extracts the semantic structure of the screen through DOM and accessibility APIs, then produces a compact JSON document (10-100 KB) containing:

- A canvas descriptor (viewport dimensions, coordinate system)
- A tree of semantic objects (buttons, text fields, containers, links, etc.) with types, positions, sizes, states, and available actions
- Visual fragments only for elements that cannot be described through structural data alone (images, canvas elements, custom widgets)

The LLM receives this JSON, reasons about the scene, and returns an action (click, type, scroll, navigate). The SDK executes the action against the DOM, and the cycle repeats — with subsequent snapshots transmitted as diffs rather than full documents.

---

## Repository Structure

visual-scene-language/
  src/                  Core SDK source code
  extension/            Chrome browser extension (Manifest V3)
  packages/
    mcp-server/         Model Context Protocol server for VSL
  tests/                Integration and extension tests
  scripts/              Demo and utility scripts
### Core SDK (`src/`)

The SDK is organized into six modules, each corresponding to a stage of the capture-to-action pipeline:

| Module | Path | Responsibility |
|---|---|---|
| **Capture** | `src/capture/` | DOM tree extraction, element metadata, computed styles, bounding rectangles |
| **Segmentation** | `src/segmentation/` | Multi-level semantic classification (tag-based, ARIA role, CSS heuristic, structural, vision-assisted) |
| **Builder** | `src/builder/` | Assembles segmented elements into a VSL JSON document |
| **Cache & Diff** | `src/cache/`, `src/diff/`, `src/session/` | Content-hash and coordinate-hash caching, mutation observer invalidation, diff engine, snapshot sessions |
| **Action Executor** | `src/executor/` | Resolves target IDs to DOM elements and executes actions (click, type, scroll, navigate, select, etc.) |
| **Vision** | `src/vision/` | Visual fragment extraction, vision-based enrichment, LLM vision classifier |

### MCP Server (`packages/mcp-server/`)

A standalone Model Context Protocol server that exposes VSL capabilities as tools for any MCP-compatible AI agent. Available tools:

- `vsl_get_snapshot` — capture the current page as a VSL JSON document
- `vsl_get_diff` — retrieve only the changes since the last snapshot
- `vsl_execute_action` — execute an action (click, type, scroll, navigate) on the page
- `vsl_navigate` — navigate the browser to a specified URL
- `vsl_read_page` — hybrid page reader (HTTP-first for static pages, headless browser for SPAs)
- `vsl_get_text_block` — retrieve a cached long-form text block by reference ID
- `vsl_get_visual` — retrieve a visual fragment (image/canvas) by reference ID
- `vsl_get_full_json` — retrieve the complete VSL document without diff compression
- `vsl_clear_cache` — invalidate the snapshot cache
- `vsl_download` — download a resource from the page

### Browser Extension (`extension/`)

A Chrome extension (Manifest V3) that runs VSL capture and action execution directly in the browser. It provides a content script for DOM interaction and a popup interface for controlling the agent session.

---

## Installation

npm install @thinkingos/vsl-sdk
Requires Node.js 18 or later.

### MCP Server Installation

The VSL MCP server enables AI agents (Claude Desktop, Cline, TaoCoder, Cursor, etc.) to interact with web pages through VSL.

**1. Install the MCP server:**

npm install @thinkingos/vsl-mcp-server
**2. Run the setup script:**

npx @thinkingos/vsl-mcp-server setup
The setup script will:
- Check Node.js version (requires >= 18)
- Install Playwright and Chromium browser (for browser-based tools)
- Save configuration to `~/.vsl/config.json`
- Output agent connection instructions

**3. Configure your agent:**

Add the following JSON configuration to your agent's MCP settings:

{
  "mcpServers": {
    "vsl": {
      "command": "npx",
      "args": ["@thinkingos/vsl-mcp-server"]
    }
  }
}
**Agent-specific configuration paths:**
- **Cline:** VS Code → Settings → Cline → MCP Servers → Add Server
- **Claude Desktop:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **TaoCoder:** `.taocoder/mcp.json`
- **Cursor:** `.cursor/mcp.json`

**Optional: Vision API configuration**

If you want to use vision-based tools (vsl_get_visual), add environment variables for your vision provider:

{
  "mcpServers": {
    "vsl": {
      "command": "npx",
      "args": ["@thinkingos/vsl-mcp-server"],
      "env": {
        "OPENAI_API_KEY": "your-openai-api-key"
      }
    }
  }
}
Supported vision providers: OpenAI (`OPENAI_API_KEY`), Anthropic (`ANTHROPIC_API_KEY`), or custom (`VSL_VISION_PROVIDER=custom`, `VSL_VISION_BASE_URL`, `VSL_VISION_API_KEY`, `VSL_VISION_MODEL`).

---

## Package Exports

The SDK publishes dual CJS/ESM builds with TypeScript declarations:

{
  "import": "./dist/index.mjs",
  "require": "./dist/index.js",
  "types": "./dist/index.d.ts"
}
---

## Key Capabilities

### Snapshot Generation

The capture pipeline extracts the DOM tree, classifies each element through a multi-level segmentation algorithm (HTML tag mapping, ARIA role resolution, CSS heuristics, structural analysis, and optional vision model enrichment), and builds a VSL JSON document with semantic object types, relative coordinates, states, and available actions.

### Cache and Diff

Static elements are cached by content hash and coordinate hash after the first snapshot. Subsequent snapshots transmit only the differences — added, modified, and removed objects — while unchanged elements are referenced by ID. Mutation observers provide point invalidation when the DOM changes between snapshots. URL navigation triggers a full cache reset; viewport resize resets only coordinate-dependent entries.

### Visual Fragments and Screenshots

When structural data alone is not sufficient, the AI agent can request a screenshot of the full screen or of a specific element identified in the VSL document. Each element in the VSL JSON carries a unique ID — the agent passes this ID to retrieve a visual fragment (image, canvas, or custom widget) as a base64-encoded WebP image. This allows the agent to fall back to pixel-level inspection only when needed, while keeping the default workflow fully semantic.

### Action Execution

Actions returned by the LLM are resolved against the live DOM. The executor maps semantic object IDs to actual DOM elements, performs the requested interaction, and returns a structured result indicating success or failure.

### Humanization Layer

To operate on sites with anti-bot detection (LinkedIn, banking portals, etc.), VSL includes a Humanization Layer that sits between the Action Executor and the browser. It makes agent actions indistinguishable from human behavior by introducing configurable timing delays, Bezier-curve mouse movements, scroll randomization, human-like typing simulation, session management, and fingerprint rotation. Configuration is per-site — each domain can have its own timing profiles, action rate limits, and typing speed ranges. The overhead (+300–3000ms per action) is intentional: it mimics real human speed and rhythm.

### Prompt Injection Filter

VSL intercepts all text extracted from the screen before it reaches the LLM. A pattern-based filter runs at the entry point of the Capture Layer — immediately after text extraction from any source (DOM, raw HTML) and before segmentation — scanning for hidden instructions embedded in `display:none` elements, alt texts, meta tags, HTML comments, and CSS content properties. Detected injections are stripped, logged, or blocked depending on severity. The pattern library supports three tiers: bundled (shipped with the SDK), remote (auto-loaded from CDN, cached locally), and custom (user-defined via configuration). This provides a defense-in-depth security layer at the middleware level.

---

## Development

npm install          # install dependencies
npm run build        # build SDK (tsup)
npm run test         # run unit tests (jest)
npm run lint         # lint source (eslint)
npm run typecheck    # type-check without emit (tsc --noEmit)
npm run test:e2e     # end-to-end tests (playwright)
npm run demo:cache-diff  # cache-diff demonstration
---

## Documentation

| Document | Description |
|---|---|
| `ARCHITECTURE.md` | System architecture: pipeline stages, data flow, caching strategy, diff format, action model |
| `PRODUCT_CONCEPT.md` | Product concept: problem statement, solution overview, use cases, competitive positioning |
| `DESIGN_SYSTEM.md` | JSON schema design principles, naming conventions, data model, API patterns |
| `DECISIONS.md` | Architectural decisions with context and rationale |
| `ROADMAP.md` | Implementation roadmap organized by phases and milestones |
| `TARGET_AUDIENCE.md` | Target audience definitions and usage scenarios |
| `README_AI.md` | Project bible for AI agents (single-document context ingestion) |

---

## License

Creative Commons Attribution 4.0 International (CC BY 4.0)

---

## Author

Maxim Zhadobin