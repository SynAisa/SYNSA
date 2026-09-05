# SYNSA

A local Windows/Electron toolkit for running a Twitch stream: alerts, a chat dashboard, and OBS browser-source overlays for music and countdowns.

## What is SYNSA?

SYNSA is a Windows desktop application (built with Electron) that runs locally on a streamer's own machine to support a Twitch broadcast. It connects to Twitch to receive alerts and chat, provides a dashboard for managing the stream, and exposes a set of browser-source overlays for OBS (or similar broadcaster software).

Twitch and YouTube Music credentials are stored locally on disk and encrypted using Electron's `safeStorage` API rather than kept in plain text.

## Features

- **Twitch Alerts** — follow, subscription, cheer, and raid alerts via Twitch EventSub
- **Chat Dashboard** — live Twitch chat, sending messages, moderation actions (timeout/ban), and an emote picker (Twitch and 7TV emotes)
- **OBS Browser Source Overlays** — dedicated overlay pages for alerts, music, and the countdown, meant to be added as Browser Sources in OBS
- **Music / Now Playing Overlay** — shows the currently playing track from the YouTube Music Desktop App (YTMDesktop), via its local Companion Server
- **Countdown Overlay** — a configurable on-screen countdown timer
- **Encrypted local credential storage** — Twitch and YouTube Music credentials are encrypted at rest using Electron's `safeStorage`
- **System tray application** — runs in the Windows system tray
- **Update-checking system** — an update architecture is in place (see [Updates](#updates) below); it is not yet validated against a real public release

## Current Status

SYNSA is in **early, active development**.

- Current version: **0.1.0**
- There is **no official public release yet** — no installer has been published via GitHub Releases
- The update system's architecture (checking, user confirmation, download, install) is implemented, but the production path against real GitHub Releases has not yet been exercised end to end
- SYNSA should not be treated as a finished product at this stage — expect rough edges and breaking changes between versions

## Installation

There is currently **no official installer available for download**. Until a first GitHub Release is published, running SYNSA means building it from source.

For developers:

```bash
npm install
npm run electron   # run SYNSA in development mode
npm run dist        # build a Windows installer (NSIS) locally via electron-builder
```

This section will be updated with a link to the Releases page once an official build is published.

## Updates

SYNSA includes an update-checking system designed to:

- Check for updates automatically on startup, and on manual request
- Never download anything without explicit user confirmation
- Show download progress before offering to install
- Never install an update while a Twitch stream is currently live

The mechanism for fetching real updates from public GitHub Releases has been implemented in code, but **has not yet been tested against an actual published release** — treat it as still in development until a first official release exists.

## Requirements

- **Windows** (the installer and credential encryption are Windows-specific)
- A **Twitch account** and your own registered **Twitch Developer application** (Client ID/Secret) to use any Twitch-related feature
- **YouTube Music Desktop App (YTMDesktop)**, with its Companion Server enabled, only if you want to use the Music/Now-Playing overlay
- **OBS Studio** (or similar broadcaster software) to actually display the browser-source overlays

## Privacy / Local Data

- SYNSA is a local Electron application that runs entirely on your own machine.
- Twitch credentials and YouTube Music pairing tokens are stored locally and encrypted using Electron's `safeStorage` API.
- Alert/event history and module settings are stored locally on your machine.
- SYNSA communicates with Twitch's API and EventSub for the features that need it (alerts, chat, channel info), with 7TV's public API to load emotes, and with the YouTube Music Desktop App's local Companion Server on your own machine for the music overlay.

This section describes what the software does technically; it is not a legal privacy policy.

## Development

```bash
npm install
npm run electron
npm run dist
```

`CLAUDE.md` in this repository contains internal development guidelines and architectural notes used while working on SYNSA with AI coding assistance. It is not end-user documentation.

## License

SYNSA is proprietary software. The source code in this repository is publicly viewable, but this does **not** grant any right to use, copy, modify, or redistribute it. See [LICENSE](LICENSE) for details.
