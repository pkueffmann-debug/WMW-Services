# Daylens — Phase 3 Audit-Plan & 90-Tage-KPIs

## Lighthouse-Audit (vor Marketing-Launch)

### Setup
1. Deploy auf Vercel → Production-URL (daylens.dev)
2. Vercel-Project-Settings: **Root Directory = `website`**, Framework Preset = Other
3. Pull-Request-Previews automatisch durch Vercel-Integration
4. Audit-Tool: `lighthouse` (CLI v11+) gegen Live-URL, **Mobile-Profil**, Throttling = simulated 4G

### Kommando
```bash
npx lighthouse https://daylens.dev/ \
  --output=html --output-path=./audit/landing.html \
  --emulated-form-factor=mobile \
  --throttling-method=simulate \
  --chrome-flags="--headless"
```
Wiederholen für: `/cafe`, `/kanzlei`, `/trainer`, `/about`, `/chatbot`, `/pricing` (falls eigene Route), `/impressum`, `/datenschutz`.

### Schwellenwerte (Strategist-Spec)
- Performance ≥ **90** (mobile)
- Accessibility ≥ **95**
- Best Practices ≥ **95**
- SEO ≥ **95**

### Erwartete Stolpersteine
- **Three.js Bundle 652 KB** auf der Hauptseite → ggf. nur on-scroll-into-view laden (currently dynamic-import on init)
- **Demo-Subsites** laden noch Google Fonts (Cormorant/Archivo/Caveat) → -3 Punkte
- **Hero-Loader 2.2s** Min-Display-Time blockiert FCP/LCP-Wahrnehmung — eventuell auf 1.2s reduzieren
- **Subtle film grain SVG** in `body::before` ist data: URL — kein Request, OK

### Fix-Reihenfolge nach erstem Audit
1. Wenn Mobile-Performance < 90: Three.js conditional auf `IntersectionObserver(hero)`
2. Wenn LCP > 2.5s: Loader-Mindestzeit auf 1.0s, hero-image preload
3. Wenn Accessibility < 95: Color-Contrast prüfen (caramel auf cream kann schwach sein), aria-labels nachreichen
4. Wenn SEO < 95: structured data (LocalBusiness Schema) im Footer

---

## 90-Tage-KPIs (Strategist-Spec)

| # | Metrik | Ziel | Messung |
|---|---|---|---|
| 1 | **Qualifizierte Leads / Monat** | ≥ 5 ab Monat 2 | Eingehende Anfragen via Form + Email, manuell qualifiziert (Branche, Budget, Zeitrahmen) |
| 2 | **Pilot-Kunden bis Q3** | 2 von 3 Plätzen besetzt | Unterzeichnete Verträge (notariell vertretene Minderjährigen-Verträge) |
| 3 | **Mobile Lighthouse Performance** | > 90 stabil | Wöchentlicher Audit, Werte in `/audit/`-Folder mit Datum |

### Sekundäre Metriken (für interne Steuerung, nicht öffentlich)
- Hero-CTR auf "Kostenloses Erstgespräch" — Ziel 4 %+
- Pricing-Section Scroll-Tiefe — Ziel 60 %+ der Besucher
- /about-Reach — Ziel 25 % der Erstbesucher
- /chatbot-Reach — Ziel 15 % der Erstbesucher

### Was wir NICHT messen
- Aggregierte Lighthouse-Werte ohne Datum (cherry-picking-Gefahr)
- "Page Views" ohne Conversion-Kontext
- Time-on-page (für eine Lead-Site irrelevant)

---

## Verbleibende Tech-Schulden (Phase 4)

1. **Demo-Fonts self-hosten** — Cormorant Garamond, Source Sans 3, Archivo Black, Space Grotesk, Caveat (~8 weitere woff2-Dateien, ~250 KB)
2. **Forms an Resend anbinden** — aktuell loggen die Forms nur in die Console; Vercel-Function `/api/submit` mit Resend-API + Honey-Pot-Spam-Schutz
3. **Sitemap.xml + robots.txt** — für SEO-Score
4. **Structured Data** — LocalBusiness Schema im Footer (Adresse, Telefon, Öffnungszeiten?, Sameas)
5. **OG-Image generieren** — aktuell nur Text-Metadaten, kein Bild → schwächer in Social-Shares
6. **404-Page custom** — Vercel zeigt Default, hässlich; eigene 404.html stylen
7. **Cookie-Banner** — Aktuell keiner. Da wir keine Tracking-Cookies setzen, ist das OK — aber TTDSG-konform muss eine Info-Pflicht bedacht werden (eine kurze info-Banner-Variante).

---

## Marken/Domain-Stand

- **Domain** daylens.dev (bleibt)
- **Marke** Daylens (sichtbar überall)
- **Geschäftsname** WMW Services (nur im Impressum)
- **E-Mail** paul@daylens.dev (muss noch tatsächlich gerouted werden via Cloudflare/Resend MX oder Vercel-Email-Forwarding)
- **Telefon** +49 175 2895869 (korrigiert)

## Vercel-Setup-Aufgaben

- [ ] Vercel-Project auf `pkueffmann-debug/WMW-Services` connect (war: pkueffmann-debug/Jarvis)
- [ ] Root Directory = `website` setzen
- [ ] Custom Domain daylens.dev am Project hängen lassen
- [ ] E-Mail-Forwarding paul@daylens.dev → p.kueffmann@icloud.com einrichten
- [ ] Environment-Variablen für `/api/checkout.js`, `/api/send-email.js`, `/api/stripe-webhook.js` (sofern beibehalten)
