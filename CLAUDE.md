# JARVIS — Claude Code Context

## Was ist das?
Electron Desktop App + Web-Brain auf daylens.dev.
Stack: React, Vite, Tailwind, Node.js, Supabase Postgres (cloud), Vercel.
Lokaler State: JSON-Dateien in `~/.jarvis/` für Memory & History.

## Architektur
- Desktop App (Electron) → ~/jarvis/main.js
- Brain Web-App → daylens.dev/brain
- WebSocket Bridge → services/wsbridge.js (Port 7777)
- API Endpoints → api/brain/

## Wichtige Regeln
- JavaScript only — kein TypeScript-Umbau.
  JSDoc-Kommentare bei neuen Funktionen sind nice-to-have, kein Muss.
- Keine hardcoded API Keys.
- Mobile-first CSS.
- Vor **großen** Changes fragen:
  - Supabase Schema-Änderungen (neue Tabellen, Spalten, Constraints)
  - Neue npm Dependencies
  - API Breaking Changes (Response-Shape, Status-Codes, neue Auth)
  - Auth- / Login-Pfade
  - Build-Config (electron-builder, vite, vercel.json)

  UI-Polish und isolierte Features → direkt machen, keine Rückfrage.

## Aktuelle Features
- Multi-AI (Claude, GPT, Gemini, Groq, Mistral)
- Wake Word (Picovoice)
- Voice Pipeline (Groq STT + ElevenLabs TTS)
- Gmail + Calendar Integration
- Dashboard auf /brain/dashboard
- WebSocket Desktop↔Browser Bridge

## Was fehlt noch
- Hand Tracking (MediaPipe)
- Telegram Bot
- Ollama lokal
- Emotion Detection, das hier soll rein!!!
