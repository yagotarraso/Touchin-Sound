# Touching Sound

A web app that lets you create music in real time using hand gestures — no instruments needed.

Built with MediaPipe for hand tracking via webcam. Each hand controls a different aspect of the sound: one selects instruments and effects, the other plays and modulates them. Up to four simultaneous audio layers with synthesis, drum samples, and live effects.

## Tech

- **Hand tracking** — MediaPipe Hands (loaded from CDN)
- **Audio** — Web Audio API (synthesis + WAV drum samples)
- **Deployment** — Cloudflare Pages (static, no backend)
- **Offline** — Service Worker with full asset precaching

## Structure

```
index.html      Landing page and tutorial
app.html        Main app
main.js         App orchestration
audio.js        Audio engine (synthesis + effects)
ui.js           Canvas rendering and menus
gestures.js     Gesture recognition logic
layers.js       Audio layer management
sw.js           Service Worker
_headers        Cloudflare cache rules
_redirects      Cloudflare redirects
fonts/          EricaOne + Montserrat
svg/            Illustrations and UI icons
samples/        Drum WAV samples
```

## Usage

https://touchin-sound.pages.dev/  
Open the deployed URL, allow camera access, and follow the on-screen tutorial.  
No installation required.

## Credits

Made by Yago Tarraso · 2025  
Final project — GDTM, Universidad Politécnica de València
