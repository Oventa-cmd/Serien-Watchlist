# Als Nächstes – Einrichtung (ca. 20 Minuten, einmalig)

## 1. TMDB-Schlüssel holen
1. Konto auf https://www.themoviedb.org anlegen, E-Mail bestätigen
2. Profilbild → **Einstellungen** → **API** → „API-Schlüssel anfordern“ → **Developer**
3. Bedingungen akzeptieren, Formular ausfüllen (Typ: Persönlich, URL: deine spätere GitHub-Pages-Adresse oder „privat“)
4. **API-Schlüssel** kopieren und aufheben. Er kommt nicht in den Code, sondern wird beim ersten Start in der App eingegeben.

## 2. Supabase einrichten (Datenbank + Login)
1. Auf https://supabase.com kostenlos registrieren → **New project** (Region: Frankfurt, Passwort beliebig)
2. **SQL Editor** → New query → Inhalt von `supabase.sql` einfügen → **Run**
3. **Project URL** und **Publishable Key** (oder „anon public“ Key) kopieren
   (oben auf **Connect** klicken oder Project Settings → API Keys)
4. In `config.js` eintragen:
   ```js
   supabaseUrl: "https://abcdefgh.supabase.co",
   supabaseKey: "sb_publishable_…"
   ```
5. **Authentication → URL Configuration**: als *Site URL* deine GitHub-Pages-Adresse eintragen (aus Schritt 3)
6. Optional bequemer: **Authentication → Sign In / Providers → Email** → „Confirm email“ ausschalten. Dann entfällt die Bestätigungsmail.

## 3. Online stellen mit GitHub Pages
1. Auf GitHub ein neues Repository anlegen, z. B. `watchlist` (**Public**)
2. **Add file → Upload files** → alle Dateien aus diesem Ordner hineinziehen (inkl. Ordner `icons`) → **Commit**
3. **Settings → Pages** → Source: *Deploy from a branch* → Branch `main`, Ordner `/ (root)` → **Save**
4. Nach 1–2 Minuten läuft die App unter `https://DEIN-NAME.github.io/watchlist/`

## 4. Erster Start
1. Seite öffnen → **Konto erstellen** (E-Mail + Passwort)
2. TMDB-Schlüssel einfügen → fertig. Auf weiteren Geräten nur noch anmelden.
3. Empfohlen: Danach in Supabase unter **Authentication → Sign In / Providers** „Allow new users to sign up“ ausschalten, damit niemand sonst dein Projekt nutzt.

## Als App auf den Homescreen
- **iPhone:** In Safari öffnen → Teilen → „Zum Home-Bildschirm“
- **Android:** In Chrome öffnen → Menü → „App installieren“
- **Windows/Mac:** In Chrome/Edge → Installieren-Symbol in der Adressleiste

## Bedienung
| Ansicht | Was du dort machst |
|---|---|
| Start | Wechselnder Hero (Als Nächstes + Top-Empfehlungen), Am Gucken, Warteschlange und ~20 Reihen: Für dich, „Weil du X magst“, Top 10, deine Genres, Neu bei deinen Diensten, Versteckte Perlen, Hochgelobt, Trends, Neue Folgen, Bald im Kino |
| Liste | Vier Spalten (Geplant / Am Gucken / Fertig / Abgebrochen), per Griff ⋮⋮ ziehen zum Sortieren |
| Entdecken | Suche (Taste `/`), Serien/Filme, Genre-Chips mit Sortierung (Beliebt/Top/Neu) und „Mehr laden“ |
| Einstellungen | Eigene Streamingdienste wählen, ausgeblendete Vorschläge zurücksetzen, „Effekte reduzieren“ |
| Details | Status, Sterne (auch halbe), Notiz, Anbieter in DE, Folgen pro Staffel abhaken |

Empfehlungen basieren auf deiner Liste: Hoch bewertete Titel zählen am meisten, abgebrochene oder schlecht bewertete ziehen ähnliche Vorschläge nach unten. Zusätzlich fließen dein Genre-Profil, die TMDB-Bewertung und Aktualität ein; Titel, die von mehreren deiner Serien empfohlen werden, steigen nach oben. In der Detailansicht blendet „Kein Interesse“ einen Vorschlag dauerhaft aus.

## Später etwas ändern
Dateien im GitHub-Repo ersetzen (Upload überschreibt) – nach 1–2 Minuten ist die neue Version online. Deine Daten bleiben in Supabase.
