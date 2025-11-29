# Nano Banana

Generate beautiful diagrams and graphs with Gemini AI directly inside VS Code.

![Nano Banana](media/icon.png)

## Features

- **AI-Powered Diagram Generation** - Describe what you want and let Gemini create professional diagrams
- **Multiple Image Types** - Flowcharts, sequence diagrams, architecture diagrams, and more
- **Code Selection Support** - Select code in your editor and generate diagrams from it
- **Custom Templates** - Create and save your own diagram type templates
- **Configurable Output** - Choose from multiple aspect ratios (1:1, 3:4, 4:3, 9:16, 16:9)

## Getting Started

### 1. Get a Gemini API Key

1. Visit [Google AI Studio](https://aistudio.google.com)
2. Click "Get API Key"
3. Create a new API key (you may need to create a project first)

> **Note:** Billing setup may be required for API access.

### 2. Connect Your API Key

1. Open the Nano Banana panel from the activity bar (banana icon)
2. Paste your Gemini API key
3. Click "Connect & Start Creating"

### 3. Generate Diagrams

1. Select an image type from the dropdown
2. Describe what you want to visualize
3. Click "Generate"

You can also:
- Select code in your editor and click "Selection" to generate a diagram from it
- Right-click selected code and choose "Generate Diagram from Selection"

## Commands

| Command | Description |
|---------|-------------|
| `Nano Banana: Open Nano Banana` | Open the Nano Banana panel |
| `Nano Banana: Generate Diagram from Selection` | Generate a diagram from selected code |
| `Nano Banana: Set Gemini API Key` | Configure your Gemini API key |

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `nanobanana.defaultAspectRatio` | `16:9` | Default aspect ratio for generated diagrams |
| `nanobanana.defaultModel` | `gemini-3-pro-image-preview` | Gemini model for diagram generation |

## Requirements

- VS Code 1.85.0 or higher
- Gemini API key from Google AI Studio

## License

[MIT](LICENSE.md)

---

## Disclaimer

The name "Nano Banana" is used for creative and educational purposes only. We do not claim ownership of this name or any associated trademarks. This project is an independent, open-source extension and is not affiliated with or endorsed by any trademark holders. We are not associated with Google.