# 🚀 Deployment-Anleitung für Render.com

## Voraussetzungen
- GitHub Account (vorhanden ✅)
- Render.com Account (vorhanden ✅)
- Git auf deinem PC installiert

## 📋 Schritt-für-Schritt Anleitung

### 1. GitHub Repository erstellen

1. Gehe zu https://github.com/new
2. Repository Name: `imposter-game`
3. Public oder Private (beides funktioniert)
4. **KEINE** README/gitignore hinzufügen
5. **Create repository** klicken

### 2. Code zu GitHub pushen

Öffne die Kommandozeile in deinem `imposter-game` Ordner:

```bash
git init
git add .
git commit -m "Initial commit - Imposter Game"
git branch -M main
git remote add origin https://github.com/DEIN-USERNAME/imposter-game.git
git push -u origin main
```

> **Wichtig:** Ersetze `DEIN-USERNAME` mit deinem GitHub-Benutzernamen!

### 3. Auf Render.com deployen

1. Gehe zu https://dashboard.render.com
2. Klicke auf **New** → **Web Service**
3. Verbinde dein GitHub Repository (wenn noch nicht geschehen)
4. Wähle `imposter-game` Repository aus
5. Einstellungen:
   - **Name:** `imposter-game` (oder ein anderer Name)
   - **Environment:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Plan:** `Free`
6. Klicke **Create Web Service**

### 4. Deployment läuft! ⏳

Render baut jetzt deine App:
- Dauer: ca. 2-3 Minuten
- Du siehst Live-Logs im Dashboard
- Warte bis "Your service is live 🎉" erscheint

### 5. Deine URL! 🎉

Du bekommst eine URL wie:
```
https://imposter-game-xyz123.onrender.com
```

Diese URL kannst du deinen Freunden geben!

## ⚠️ Wichtige Hinweise

### Kostenloser Plan:
- ✅ Unbegrenzte Nutzung
- ⚠️ Service "schläft" nach 15 Min Inaktivität
- ⏳ Beim ersten Aufruf nach Schlaf: ~30 Sekunden Ladezeit
- 💡 Für dauerhaften Betrieb: Upgrade zu $7/Monat Plan

### Beim Spielen:
1. **Erste Spieler:** Wartet ~30 Sek wenn Service geschlafen hat
2. **Danach:** Alles läuft normal und schnell!
3. **Tipp:** Schicke Freunden den Link 5 Min vor Spielbeginn

## 🔄 Updates deployen

Wenn du Änderungen machst:

```bash
git add .
git commit -m "Update: Beschreibung der Änderung"
git push
```

Render deployed automatisch die neue Version!

## 🐛 Probleme?

### Service startet nicht:
- Überprüfe die Logs im Render Dashboard
- Stelle sicher, dass `npm install` keine Fehler zeigt

### Verbindung schlägt fehl:
- Überprüfe, dass Socket.io über HTTPS läuft
- Browser-Konsole checken (F12 → Console)

### Weitere Hilfe:
- Render Docs: https://render.com/docs
- Socket.io Docs: https://socket.io/docs/v4/

## 🎮 Viel Spaß beim Spielen!

Deine Freunde können jetzt einfach die URL öffnen und sofort spielen!
