\# SynAisaka Stream System



\## Project



This is the SynAisaka streaming control system.



The project provides:



\- Twitch EventSub integration

\- Twitch chat

\- Alert engine and alert queue

\- OBS browser sources

\- Stream dashboard

\- Alert control

\- Music overlay

\- Countdown overlay

\- Local Electron companion functionality



\---



\## Development Principles



1\. Do not unnecessarily rewrite or replace working functionality.



2\. Before modifying important architecture, inspect the existing implementation first.



3\. Prefer small, incremental and reversible changes.



4\. Preserve the existing SynAisaka visual identity unless a redesign is explicitly requested.



5\. Do not add dependencies unless they are actually necessary.



6\. Prefer existing project utilities and modules over duplicating functionality.



7\. Do not silently change behavior that is already working.



8\. Before making substantial changes, explain:

&#x20;  - what will be changed

&#x20;  - why it is needed

&#x20;  - which files will be affected

&#x20;  - possible risks



9\. If requirements are ambiguous, ask before making a major architectural decision.



10\. Do not assume missing information.



\---



\## Design System



The SynAisaka visual identity is:



Premium Minimal Tech × Digital Ink.



Primary visual language:



\- Graphite

\- Charcoal

\- Deep Teal

\- Mint

\- Soft White



Important colors:



\- Charcoal: #151C1D

\- Deep Charcoal: #0B1112

\- Mint Teal: #35C9A8

\- Light Mint: #72E3C5

\- Deep Teal: #17665B

\- Soft White: #F1F5F3



Avoid:



\- excessive neon

\- excessive glow

\- generic cyberpunk HUDs

\- unnecessary decorative elements

\- excessive anime styling

\- unnecessary Japanese writing



Existing visual consistency is more important than adding novelty.



\---



\## Security



Never expose, print, commit or push:



\- Twitch access tokens

\- Twitch refresh tokens

\- Twitch client secrets

\- YouTube Music tokens

\- OAuth sessions

\- cookies

\- authentication data

\- private runtime data

\- private chat history

\- private alert history

\- local user data



The `data/` directory contains local runtime data.



The `data/` directory must remain local and must never be committed.



Never use:



git add -f



for ignored files.



Never modify `.gitignore` in a way that exposes secrets or private runtime data.



Do not place secrets directly into source code.



Do not print secrets into terminal output or logs.



\---



\## Local Runtime Data



Local runtime data may include:



\- encrypted credentials

\- encrypted tokens

\- local configuration

\- event history

\- chat history

\- music authentication data

\- runtime state



These files must remain local.



Do not move local secrets into the source tree simply to make development easier.



\---



\## OBS



OBS Browser Sources are part of the local streaming environment.



Do not expose personal OBS configuration.



Do not hardcode personal Windows paths.



Prefer configurable or relative paths.



Do not add secrets to Browser Source URLs.



\---



\## Twitch



Twitch integration must remain compatible with the existing architecture.



When modifying Twitch functionality, consider:



\- authentication

\- EventSub

\- reconnect behavior

\- token lifecycle

\- duplicate events

\- connection failures

\- rate limits

\- queue behavior



Do not replace the existing Twitch implementation without first understanding it.



\---



\## Alerts



Alerts must remain:



\- reliable

\- queue-aware

\- visually consistent

\- OBS-compatible

\- non-blocking



Consider:



\- multiple alerts arriving simultaneously

\- queue order

\- duplicate events

\- animation timing

\- alert cancellation

\- reconnects

\- delayed events



The active alert must never prevent the application from processing later events.



\---



\## Chat



Chat functionality should remain responsive.



When changing chat functionality, consider:



\- message ordering

\- reconnects

\- moderation events

\- message highlighting

\- filters

\- performance with high chat volume



\---



\## Music Overlay



The Music Overlay should remain:



\- permanently visible when enabled

\- cover-based

\- minimal

\- synchronized with the current song

\- visually consistent with SynAisaka



Do not add unnecessary branding to the music card.



The album cover should remain the primary visual identifier of the currently playing music.



\---



\## Git Workflow



Before major changes:



1\. Check `git status`.

2\. Inspect the relevant files.

3\. Understand the current implementation.

4\. Explain the intended change.



After changes:



1\. Test the affected functionality.

2\. Run appropriate checks.

3\. Inspect `git diff`.

4\. Check `git status`.

5\. Report changed files.

6\. Report remaining issues.



Do not automatically create commits.



Do not automatically push to GitHub.



Only commit or push when explicitly requested.



\---



\## Current Repository



Local project:



C:\\Users\\dspan\\Documents\\Stream alerts



GitHub repository:



https://github.com/SynAisa/SYNSA



Main branch:



main



\---



\## Working Style



Act as a senior development partner.



Do not blindly follow instructions if they would create a security, architecture or reliability problem.



If a requested change conflicts with existing functionality, explain the conflict before changing it.



Prefer stable, maintainable solutions over clever or unnecessarily complex solutions.



When reviewing code, distinguish between:



\- Critical

\- High

\- Medium

\- Low



Do not make unrelated changes while implementing a requested feature.

<!-- Git workflow test -->

