# Visual Scene Language (VSL)

**VSL (Visual Scene Language)** is a JSON format and set of tools for AI agents working with web pages.

Instead of sending bulky screenshots (1–2 MB) to a language model, VSL extracts the **semantic structure** of a page and represents it as a compact JSON document (10–100 KB). The language model receives a structured description of elements — buttons, input fields, links, containers — with their types, positions, sizes, and states.

## How It Works

Web page → VSL extracts structure → Compact JSON → AI agent makes decision → Action → New snapshot
VSL acts as a mediator between the browser and the AI agent:
1. **Structure extraction** — VSL analyzes the page DOM and extracts semantic objects (buttons, fields, links, etc.)
2. **Compact representation** — each element receives a unique ID, type, position, and text
3. **Actions** — the agent selects an element by ID and performs an action (click, text input, scroll)
4. **Updates** — after the first snapshot, subsequent ones are transmitted as diffs (changes only), saving 60–80% of tokens

## Installation

### 1. Install the MCP server

npm install @thinkingos/vsl-mcp-server
Requires Node.js 18 or later.

### 2. Run the setup

npx @thinkingos/vsl-mcp-server setup
The setup script will:
- Check Node.js version
- Install Playwright and Chromium browser
- Save configuration to `~/.vsl/config.json`
- Output instructions for connecting to your agent

### 3. Connect to your AI agent

Add the MCP server configuration to your agent's settings:

{
  "mcpServers": {
    "vsl": {
      "command": "npx",
      "args": ["@thinkingos/vsl-mcp-server"]
    }
  }
}
**Configuration paths for different agents:**
- **Cline:** VS Code → Settings → Cline → MCP Servers → Add Server
- **Claude Desktop:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **TaoCoder:** `.taocoder/mcp.json`
- **Cursor:** `.cursor/mcp.json`

## Tools

VSL provides 8 tools for working with web pages:

### vsl_get_snapshot

Get the current page structure in VSL JSON format.

**Parameters:**
- `url` (optional) — page URL. If not specified, uses the current page
- `detail_level` — detail level: `low` (interactive elements only), `medium` (interactive + containers, default), `high` (all elements)
- `ttl` — cache time in milliseconds (default 5000)
- `full` — return full document without filtering

**Usage example:**
{
  "detail_level": "medium"
}

### vsl_execute_action

Perform an action on a page element.

**Parameters:**
- `action` — action name
- `target_id` — element ID from snapshot
- `value` — value for the action (text for input, option for selection, etc.)
- `return_state` — return updated page state after action (default true)

**Supported actions:**
- **click** — click on an element
- **type** / **fill** — enter text into a field
- **clear** — clear a field
- **scroll** — scroll the page (`"up"`, `"down"`, `"left"`, `"right"` or `"down:300"` to specify pixel amount)
- **select** — select an option from a list
- **hover** — hover over an element
- **focus** / **blur** — set/remove focus
- **check** / **uncheck** — check/uncheck a checkbox
- **press** — press a keyboard key (`"Enter"`, `"Tab"`, `"Escape"`, `"ArrowDown"`, `"ArrowUp"`, `"Space"`, `"Backspace"`)
- **upload** — upload a file (specify file path)
- **download** — download a file
- **drag** / **drop** — drag and drop
- **submit** / **reset** — submit/reset a form
- **open** / **close** — open/close an element
- **expand** / **collapse** — expand/collapse
- **wait** — wait
- **go_back** / **go_forward** — navigate back/forward
- **refresh** — refresh the page

**Examples:**
{"action": "click", "target_id": "btn_1"}
{"action": "type", "target_id": "inp_2", "value": "hello@mail.com"}
{"action": "press", "target_id": "inp_1", "value": "Enter"}
{"action": "upload", "target_id": "file_input_0", "value": "/path/to/file.pdf"}
### vsl_navigate

Navigate to the specified URL.

**Parameters:**
- `url` — page address to navigate to

**Example:**
{"url": "https://example.com"}

### vsl_read_page

Read the content of a web page. Automatically determines the strategy: static pages are read via HTTP (fast), SPAs are rendered via browser.

**Parameters:**
- `url` — page address to read
- `readable` — read-only main content mode (without navigation, footers, cookie banners)

**Example:**
{"url": "https://example.com/article", "readable": true}

### vsl_get_visual

Get a visual fragment (screenshot) of an element in base64 WebP format. Used for elements that are difficult to classify by text alone (icons, charts, custom widgets).

**Parameters:**
- `element_id` — element ID from snapshot
- `auto_refresh` — automatically refresh snapshot before searching for the element

**Example:**
{"element_id": "img_5"}

### vsl_get_text_block

Get the full text by reference. Long texts (more than 200 characters) are automatically replaced with a preview and reference in the main JSON. This tool returns the full text.

**Parameters:**
- `block_id` — text block ID (format `tb_xxx`)

**Example:**
{"block_id": "tb_001"}

### vsl_click_coordinates

Perform clicks at coordinates relative to an element. Coordinates are specified in pixels from the top-left corner of the element.

**Parameters:**
- `target_id` — element ID (e.g., iframe for clicking inside it)
- `clicks` — array of clicks with coordinates and delays

**Example:**
{
  "target_id": "iframe_2",
  "clicks": [
    {"x": 50, "y": 50, "delay_after_ms": 500},
    {"x": 150, "y": 50}
  ]
}

### vsl_clear_cache

Clear the snapshot cache. Used when you need a fresh snapshot from scratch (after significant page changes or when switching to a different site).

**Parameters:** none

## Configuration

After running `setup`, the configuration is saved to `~/.vsl/config.json`.

**Main parameters:**


{
  "browser": {
    "headless": true,
    "navigationTimeout": 30000,
    "renderTimeout": 10000,
    "downloadsPath": "~/.vsl/downloads"
  }
}


## Usage Examples

### Basic Workflow

1. vsl_navigate → open a page
2. vsl_get_snapshot → get the structure
3. Find the desired element by ID
4. vsl_execute_action → perform an action
5. Repeat steps 2-4 as needed

### Filling a Form

// 1. Open the page
{"tool": "vsl_navigate", "args": {"url": "https://example.com/form"}}

// 2. Get snapshot
{"tool": "vsl_get_snapshot", "args": {}}

// 3. Fill in fields
{"tool": "vsl_execute_action", "args": {"action": "type", "target_id": "inp_name", "value": "John Doe"}}
{"tool": "vsl_execute_action", "args": {"action": "type", "target_id": "inp_email", "value": "john@example.com"}}

// 4. Submit the form
{"tool": "vsl_execute_action", "args": {"action": "click", "target_id": "btn_submit"}}
### Reading an Article

// 1. Read the page (fast HTTP mode)
{"tool": "vsl_read_page", "args": {"url": "https://example.com/article", "readable": true}}

// 2. If you need the full text of a long block
{"tool": "vsl_get_text_block", "args": {"block_id": "tb_001"}}

## Roadmap

VSL is being developed in phases. The current MCP server covers **Phase 1 (Web MVP)**. Future phases:

| Phase | Description | Status |
|-------|-------------|--------|
| **Phase 1: Web MVP** | MCP server for web pages — snapshots, actions, caching, diff | ✅ Done |
| **Phase 2: Desktop** | Native app automation on macOS (AX API), Windows (UI Automation), Linux (AT-SPI) | Planned |
| **Phase 3: Mobile** | Mobile app automation on iOS (VoiceOver) and Android (TalkBack) | Planned |
| **Phase 4: Extended Domains** | 2D drawings (SVG/PDF), 3D scenes (Three.js/Babylon.js), BIM/CAD (IFC/DWG) | Planned |
| **Phase 5: Humanization Layer** | Anti-bot bypass: human-like timing, mouse movement, typing, fingerprint rotation | Planned (next) |
| **Phase 6: Ecosystem** | Open standard specification, community, 3rd-party integrations | Planned |

### Humanization Layer (next step)

For working with sites that have anti-automation protection (LinkedIn, banking portals, government services), a humanization layer is planned as the next development step:

- **Timing** — random delays between actions that mimic human behavior
- **Mouse movement** — Bezier curves instead of straight lines
- **Scrolling** — random scroll patterns
- **Text input** — random delays between keystrokes, typos with corrections
- **Session management** — random session durations and breaks
- **Fingerprint rotation** — changing user agent, WebGL, canvas hash

This layer will be optional and configurable for each site separately.

## License

Creative Commons Attribution 4.0 International (CC BY 4.0)

## Author

Maxim Zhadobin