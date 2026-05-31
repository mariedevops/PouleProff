# PouleProff — Marketing & Monetization Playbook

## 1. Direct actions (do this week)

### Google Search Console
1. Go to https://search.google.com/search-console
2. Add property → URL prefix → https://www.pouleproff.nl
3. Verify via HTML tag (paste the <meta name="google-site-verification"> tag in index.html <head>)
4. Submit sitemap: https://www.pouleproff.nl/sitemap.xml
5. Check back in 3-5 days to see if Google has crawled the site

### Plausible Analytics
- Log in at https://plausible.io
- Update your tracked domain from the Azure URL to: pouleproff.nl
- The script tag in index.html already uses data-domain="pouleproff.nl" ✓

---

## 2. SEO keyword targets

These are the Dutch search terms to optimize for. The site already uses most of them.

| Keyword | Monthly searches (est.) | Competition |
|---|---|---|
| scorito voorspelling | 800–1200 | Low |
| eredivisie poule tips | 400–700 | Low |
| scorito invullen | 300–600 | Low |
| f1 poule voorspelling | 200–400 | Very low |
| eredivisie voorspeller | 150–300 | Low |
| scorito cheat sheet | 100–200 | Very low |

**All low competition = realistic to rank top 5 within 3–6 months.**

---

## 3. Community posts (copy-paste ready)

### Reddit r/soccer / r/formula1 (English)
```
I built a free tool that tells you exactly what to fill in for your Scorito pool.

It predicts Eredivisie scores and F1 podiums based on recent form, head-to-head records,
and home advantage. No sign-up, just pick the match and get a prediction.

→ pouleproff.nl

Would love feedback from fellow pool players!
```

### Voetbalzone / Dutch football forums (Dutch)
```
Hoi allemaal,

Ik heb een gratis tool gebouwd voor iedereen die meedoet aan een Scorito-poule:
pouleproff.nl

Je kiest gewoon de wedstrijd en hij geeft je direct een voorspelling op basis van:
- Recente vorm (laatste 5 wedstrijden)
- Onderlinge duels
- Thuisvoordeel
- Aanvals- en verdedigingsstatistieken

Ook Formule 1-voorspellingen zijn nu beschikbaar. Geen account nodig, gewoon gratis gebruiken.

Benieuwd wat jullie ervan vinden!
```

### WhatsApp / poule-groepchats
```
Tip voor de poule: pouleproff.nl — geeft je direct een slimme Scorito-voorspelling.
Werkt ook voor F1. Gratis, geen account nodig 👌
```

### Twitter/X
```
Nooit meer blindelings je Scorito-poule invullen 🎯

PouleProff geeft je in 1 klik een voorspelling voor Eredivisie & F1 op basis van echte stats.

Gratis → pouleproff.nl

#Scorito #Eredivisie #F1 #Poule
```

---

## 4. Monetization roadmap

### Phase 1 — Now (0–500 monthly visitors)
- Keep it free and clean. Build trust.
- Add a Ko-fi / Buy Me a Coffee donate button (€5–10 per supporter)
  → https://ko-fi.com / https://buymeacoffee.com
  → Add a small "☕ Koop me een koffie" link in the footer

### Phase 2 — Traction (500–5,000 monthly visitors)
- **Affiliate: Scorito** — contact them directly at info@scorito.nl
  Ask for an affiliate/referral arrangement. You send them signups, they pay per conversion.
- **Affiliate: Sports betting** — apply to:
  - Unibet NL affiliate: https://affiliates.unibet.com
  - BetCity NL affiliate: https://affiliates.betcity.nl
  - Bet365 affiliate: https://www.bet365affiliates.com
  Add a tasteful "Wedden op deze uitslag?" banner near the prediction result.
  NL betting affiliates typically pay €30–80 CPA (cost per acquisition).
  ⚠️ Required: KSA (Kansspelautoriteit) compliance text next to any betting link.
    Add "18+ | Speel bewust | ksa.nl" next to betting affiliate links.

### Phase 3 — Scale (5,000+ monthly visitors)
- **Google AdSense** — apply at https://adsense.google.com
  At 5k+ visitors/month with Dutch audience, CPM is typically €3–8.
  Place one leaderboard ad below the prediction result, one in the sidebar.
  Don't add ads before this point — they hurt UX and the money isn't worth it.
- **Premium tier** — €2.99/month via Stripe for:
  - Email alerts before each matchday with the predicted scoreline
  - Season prediction history
  - Confidence scores over time
  - Multi-match batch predictions

---

## 5. Backlink targets (contact for a link)

These Dutch sports/tech sites linking to you = big SEO boost:

| Site | Why | How |
|---|---|---|
| voetbalzone.nl | Huge Dutch football community | Post in forum, mention the tool |
| scorito.nl blog | They might feature useful tools | Email them |
| vi.nl (Voetbal International) | Major Dutch football media | Long shot, but try |
| f1-fansite.nl | Dutch F1 community | Post in forum |
| reddit.com/r/NederlandseVoetbal | Dutch football subreddit | Post tool |
| dutchf1fans.nl | Dutch F1 fans | Post tool |

---

## 6. Technical SEO checklist

- [x] Meta title & description
- [x] Open Graph tags (Facebook, WhatsApp)
- [x] Twitter Card
- [x] Schema.org WebApplication markup
- [x] sitemap.xml at /sitemap.xml
- [x] robots.txt at /robots.txt
- [x] Canonical URL
- [x] Dutch language (lang="nl")
- [x] Mobile responsive
- [x] Fast load (static site on Azure CDN)
- [x] Favicons + apple-touch-icon
- [x] theme-color meta tag
- [ ] Google Search Console verified (do this after domain DNS propagates)
- [ ] Core Web Vitals check: https://pagespeed.web.dev — target green on all three
- [ ] Update sitemap lastmod dates after each content update

