# Voca

Voca is a voice dictation app that lives in a small notch-style overlay. Press a key, speak, and your words are typed into whatever app you're using.


## Features

- **Notch overlay:** A minimal, Apple-inspired indicator that stays out of your way.
- **Push-to-talk key:** Choose the key you want to hold or press to start dictating during setup.
- **Multilingual:** Pick a primary language, and optionally a secondary one. Switch between them anytime with `Ctrl + Shift + L`.
- **Auto-detect:** Let Voca figure out the spoken language automatically.
- **Emoji support:** Say emoji names and Voca will insert them.
- **Guided setup:** A step-by-step setup page walks you through permissions, your key, your model, a test, and your languages.

## Requirements

- Node.js 18 or later
- Microphone access
- Accessibility permission, so Voca can type into other apps (macOS)

## Installation

```bash
git clone https://github.com/your-username/voca.git
cd voca
npm install
```

## Usage

Start the app in development mode:

```bash
npm run dev
```

On first launch, the setup page opens and guides you through these steps:

1. **Permissions:** Grant microphone and accessibility access.
2. **Key:** Choose the key that starts and stops dictation.
3. **Model:** Pick a speech recognition model.
4. **Test:** Try dictating into the test box.
5. **Languages:** Choose your primary language and an optional secondary one.

After setup, hold your key and speak. The notch overlay shows when Voca is listening, and your text appears where your cursor is.

## Language Switching

Voca uses your primary language by default. If you added a secondary language, press `Ctrl + Shift + L` at any time to switch between the two.

## Project Structure

```
voca/
├── main.js          # Electron main process, notch overlay, shortcuts
├── setup/           # Setup page (permissions, key, model, test, languages)
├── app/             # Next.js app and styles (if applicable)
└── README.md
```

## Theming

Voca's notch design is built around a theme setup, so new visual styles can be added without rewriting the overlay. Typography uses Geist, with a pixel-style display font for headings.

## Roadmap

- Improved theme options
- Additional language support
- Possible Gmail integration (under consideration)