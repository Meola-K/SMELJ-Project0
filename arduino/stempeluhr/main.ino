#include <WiFi.h>
#include <HTTPClient.h>
#include <SPI.h>
#include <MFRC522.h>
#include <TFT_eSPI.h>
#include <ArduinoJson.h>
#include <WebSocketsClient.h>

// Bibliotheken (Arduino IDE → Bibliotheksverwalter):
//   * MFRC522 (by GithubCommunity)
//   * TFT_eSPI (by Bodmer)
//   * ArduinoJson (by Benoit Blanchon, v7+)
//   * WebSockets (by Markus Sattler, v2.4+)

#define WIFI_SSID "J"
#define WIFI_PASS "12345678J"
#define SERVER_HOST "172.20.10.2"
#define SERVER_PORT 3001
#define DEVICE_ID "esp32-01"

#define NFC_SS   4
#define NFC_RST  21
#define WIFI_RETRY_INTERVAL 30000
#define HOLD_DETAIL_THRESHOLD 3000   // SCRUM-285: Long-Hold > 3 s zeigt Zeitkonto
#define IDLE_AFTER_REMOVE   5000     // Stempeldaten-Schutz: 5 s Timer nach Entfernen
#define PRESENCE_POLL_INTERVAL 30000 // SCRUM-296: Auto-Refresh alle 30 s im Frontdesk-Modus
#define MODE_POLL_INTERVAL 10000     // Mode-Check alle 10 s (für Webapp-Umschalter)

MFRC522 rfid(NFC_SS, NFC_RST);
TFT_eSPI tft = TFT_eSPI();
WebSocketsClient webSocket;

enum DeviceMode { MODE_STAMP, MODE_FRONTDESK };
DeviceMode deviceMode = MODE_STAMP;

bool nfcOK = false;
unsigned long lastWifiCheck = 0;
unsigned long lastModeCheck = 0;
unsigned long lastPresencePoll = 0;

// Stempel-Modus State
String lastUID = "";
unsigned long tagFirstSeen = 0;
unsigned long tagLastSeen = 0;
unsigned long stampDisplayUntil = 0;
bool tagCurrentlyPresent = false;
bool detailShown = false;
bool stampInProgress = false;
JsonDocument lastStampDoc;
bool lastStampValid = false;

// Frontdesk State
struct PresenceEntry { String name; String status; };
PresenceEntry presence[64];
int presenceCount = 0;
int presenceScroll = 0;
unsigned long lastScrollTick = 0;

uint16_t COL_BG, COL_TXT, COL_MUTED, COL_LINE, COL_ACCENT, COL_GREEN, COL_ORANGE, COL_RED, COL_YELLOW, COL_HO, COL_VAC;

void initColors() {
    COL_BG     = TFT_BLACK;
    COL_TXT    = TFT_WHITE;
    COL_MUTED  = tft.color565(140, 140, 160);
    COL_LINE   = tft.color565(40, 40, 60);
    COL_ACCENT = tft.color565(130, 70, 255);
    COL_GREEN  = tft.color565(50, 205, 50);
    COL_ORANGE = tft.color565(255, 140, 50);
    COL_RED    = TFT_RED;
    COL_YELLOW = TFT_YELLOW;
    COL_HO     = tft.color565(60, 160, 230);
    COL_VAC    = tft.color565(220, 180, 60);
}

void nfcBegin() {
    SPI.end();
    SPI.begin(0, 19, 2, NFC_SS);
}

void tftBegin() {
    SPI.end();
    SPI.begin(18, -1, 23, 5);
}

String fmtMin(int mins) {
    bool neg = mins < 0;
    int a = abs(mins);
    return (neg ? "-" : "+") + String(a / 60) + "h " + String(a % 60) + "m";
}

String fmtTime(const char* iso) {
    String s = String(iso);
    int tPos = s.indexOf('T');
    if (tPos < 0) return s;
    return s.substring(tPos + 1, tPos + 6);
}

void drawCentered(const char* txt, int y, int size, uint16_t color) {
    tft.setTextSize(size);
    tft.setTextColor(color, COL_BG);
    int w = tft.textWidth(txt);
    tft.drawString(txt, (tft.width() - w) / 2, y);
}

void drawLine(int y) {
    for (int x = 10; x < tft.width() - 10; x += 2) tft.drawPixel(x, y, COL_LINE);
}

// ── Stempel-Modus Screens ───────────────────────────────────

void showReady() {
    tftBegin();
    tft.fillScreen(COL_BG);
    drawCentered("STEMPELUHR", 8, 2, COL_ACCENT);
    drawLine(30);

    tft.setTextSize(1);
    if (WiFi.status() == WL_CONNECTED) {
        tft.setTextColor(COL_GREEN, COL_BG);
        String ip = WiFi.localIP().toString();
        int w = tft.textWidth(ip.c_str());
        tft.drawString(ip, (tft.width() - w) / 2, 38);
    } else {
        drawCentered("OFFLINE", 38, 1, COL_RED);
    }

    drawLine(52);
    drawCentered("Karte auflegen", 64, 1, COL_MUTED);

    tft.fillCircle(tft.width() / 2, 95, 12, tft.color565(25, 25, 40));
    tft.drawCircle(tft.width() / 2, 95, 12, COL_ACCENT);
    tft.drawCircle(tft.width() / 2, 95, 8,  tft.color565(80, 50, 160));
    tft.drawCircle(tft.width() / 2, 95, 4,  tft.color565(50, 30, 100));
}

void showStatus(const char* msg, uint16_t color) {
    tftBegin();
    tft.fillScreen(COL_BG);
    drawCentered(msg, 50, 1, color);
}

// SCRUM-284: Standard-Layout ohne Saldo (nur Name, Typ, Uhrzeit, Heute).
// SCRUM-286: Visueller Hinweis "Halten für Details".
void drawStampBase(JsonDocument& doc) {
    const char* type = doc["type"];
    bool isIn = strcmp(type, "in") == 0;
    int todayMins = doc["todayMinutes"];
    const char* firstName = doc["user"]["firstName"];
    const char* lastName  = doc["user"]["lastName"];
    const char* timeStr   = doc["time"];

    tftBegin();
    tft.fillScreen(COL_BG);

    uint16_t accent = isIn ? COL_GREEN : COL_ORANGE;
    drawCentered(isIn ? "EINSTEMPELN" : "AUSSTEMPELN", 4, 2, accent);

    for (int x = 0; x < tft.width(); x++) tft.drawPixel(x, 26, accent);

    String name = String(firstName) + " " + String(lastName);
    drawCentered(name.c_str(), 34, 1, COL_TXT);

    String zeit = fmtTime(timeStr);
    drawCentered(zeit.c_str(), 48, 1, COL_MUTED);

    drawLine(62);

    tft.setTextSize(1);
    tft.setTextColor(COL_MUTED, COL_BG);
    tft.drawString("Heute:", 8, 72);
    String todayStr = fmtMin(todayMins);
    tft.setTextColor(TFT_CYAN, COL_BG);
    tft.drawString(todayStr, tft.width() - 8 - tft.textWidth(todayStr.c_str()), 72);

    // SCRUM-286: dezenter Hinweis am unteren Rand
    const char* hint = "Halten fuer Details";
    tft.setTextSize(1);
    tft.setTextColor(COL_MUTED, COL_BG);
    int hw = tft.textWidth(hint);
    tft.drawString(hint, (tft.width() - hw) / 2, tft.height() - 10);

    // Kernzeitwarnung bleibt immer sichtbar (SCRUM-284 Akzeptanz)
    const char* warning = doc["warning"];
    if (warning && strlen(warning) > 0) {
        drawLine(88);
        drawCentered(warning, 96, 1, COL_YELLOW);
    }
}

// SCRUM-285: Bei Long-Hold > 3 s zusätzlich Zeitkonto-Saldo einblenden
void drawStampDetail(JsonDocument& doc) {
    drawStampBase(doc);
    int balance = doc["balance"];

    // Hinweis durch Saldo-Zeile ersetzen
    tft.fillRect(0, tft.height() - 14, tft.width(), 14, COL_BG);
    drawLine(tft.height() - 14);

    tft.setTextSize(1);
    tft.setTextColor(COL_MUTED, COL_BG);
    tft.drawString("Konto:", 8, tft.height() - 10);
    uint16_t balColor = balance >= 0 ? COL_GREEN : COL_RED;
    String balStr = fmtMin(balance);
    tft.setTextColor(balColor, COL_BG);
    tft.drawString(balStr, tft.width() - 8 - tft.textWidth(balStr.c_str()), tft.height() - 10);
}

void showAssigned() {
    tftBegin();
    tft.fillScreen(COL_BG);
    drawCentered("ZUGEWIESEN", 30, 2, TFT_CYAN);
    drawLine(55);
    drawCentered("NFC-Tag registriert", 65, 1, COL_TXT);
}

void showUnknown() {
    tftBegin();
    tft.fillScreen(COL_BG);
    drawCentered("UNBEKANNT", 30, 2, COL_RED);
    drawLine(55);
    drawCentered("Tag nicht zugewiesen", 65, 1, COL_MUTED);
}

void showError(const char* msg, int httpCode) {
    tftBegin();
    tft.fillScreen(COL_BG);
    drawCentered("FEHLER", 30, 2, COL_RED);
    drawLine(55);
    drawCentered(msg, 65, 1, COL_MUTED);
    if (httpCode > 0) {
        String code = "HTTP " + String(httpCode);
        drawCentered(code.c_str(), 80, 1, tft.color565(120, 120, 140));
    }
}

// ── Frontdesk-Modus Screens (SCRUM-296) ─────────────────────

uint16_t statusColor(const String& s) {
    if (s == "present") return COL_GREEN;
    if (s == "ho")      return COL_HO;
    if (s == "urlaub")  return COL_VAC;
    if (s == "krank")   return COL_RED;
    return COL_MUTED;
}

const char* statusLabel(const String& s) {
    if (s == "present") return "anwesend";
    if (s == "ho")      return "HO";
    if (s == "urlaub")  return "Urlaub";
    if (s == "krank")   return "krank";
    return "abwesend";
}

void drawFrontdesk() {
    tftBegin();
    tft.fillScreen(COL_BG);
    drawCentered("ANWESENHEIT", 4, 2, COL_ACCENT);
    drawLine(24);

    if (presenceCount == 0) {
        drawCentered("Keine Daten", 60, 1, COL_MUTED);
        return;
    }

    int rowH = 11;
    int yStart = 28;
    int maxRows = (tft.height() - yStart - 4) / rowH;
    if (maxRows < 1) maxRows = 1;

    if (presenceScroll < 0) presenceScroll = 0;
    if (presenceScroll > presenceCount - maxRows) presenceScroll = max(0, presenceCount - maxRows);

    tft.setTextSize(1);
    for (int i = 0; i < maxRows && (i + presenceScroll) < presenceCount; i++) {
        int idx = i + presenceScroll;
        int y = yStart + i * rowH;

        tft.setTextColor(COL_TXT, COL_BG);
        String name = presence[idx].name;
        if (name.length() > 18) name = name.substring(0, 17) + ".";
        tft.drawString(name, 6, y);

        const char* lbl = statusLabel(presence[idx].status);
        uint16_t c = statusColor(presence[idx].status);
        int w = tft.textWidth(lbl);
        tft.setTextColor(c, COL_BG);
        tft.drawString(lbl, tft.width() - 6 - w, y);
    }

    if (presenceCount > maxRows) {
        int total = tft.height() - yStart - 4;
        int barH = max(8, total * maxRows / presenceCount);
        int barY = yStart + (total - barH) * presenceScroll / max(1, presenceCount - maxRows);
        tft.drawFastVLine(tft.width() - 2, yStart, total, COL_LINE);
        tft.drawFastVLine(tft.width() - 2, barY,   barH,  COL_ACCENT);
    }
}

// ── HTTP-Helfer ─────────────────────────────────────────────

bool ensureWifi() {
    if (WiFi.status() == WL_CONNECTED) return true;
    if (millis() - lastWifiCheck < WIFI_RETRY_INTERVAL && lastWifiCheck > 0) return false;
    lastWifiCheck = millis();

    WiFi.disconnect();
    WiFi.begin(WIFI_SSID, WIFI_PASS);
    int attempts = 0;
    while (WiFi.status() != WL_CONNECTED && attempts < 20) { delay(500); attempts++; }
    return WiFi.status() == WL_CONNECTED;
}

bool fetchPresence() {
    if (!ensureWifi()) return false;

    HTTPClient http;
    String url = "http://" + String(SERVER_HOST) + ":" + String(SERVER_PORT) + "/api/devices/" + DEVICE_ID + "/presence";
    http.begin(url);
    http.setTimeout(5000);
    int code = http.GET();
    if (code != 200) { http.end(); return false; }

    String payload = http.getString();
    http.end();

    JsonDocument doc;
    if (deserializeJson(doc, payload)) return false;

    const char* m = doc["mode"] | "stamp";
    DeviceMode newMode = (strcmp(m, "frontdesk") == 0) ? MODE_FRONTDESK : MODE_STAMP;
    if (newMode != deviceMode) {
        deviceMode = newMode;
        presenceScroll = 0;
        if (deviceMode == MODE_STAMP) {
            showReady();
            return true;
        }
    }

    if (deviceMode != MODE_FRONTDESK) return true;

    JsonArray users = doc["users"].as<JsonArray>();
    int n = 0;
    for (JsonObject u : users) {
        if (n >= 64) break;
        presence[n].name   = String(u["name"].as<const char*>());
        presence[n].status = String(u["status"].as<const char*>());
        n++;
    }
    presenceCount = n;
    drawFrontdesk();
    return true;
}

// ── WebSocket-Events (SCRUM-298) ────────────────────────────

void onWsEvent(WStype_t type, uint8_t* payload, size_t length) {
    if (type != WStype_TEXT) return;
    JsonDocument doc;
    if (deserializeJson(doc, payload, length)) return;
    const char* ev = doc["event"] | "";
    if (strcmp(ev, "presence:changed") == 0 && deviceMode == MODE_FRONTDESK) {
        // Liste neu laden – einfacher und konsistenter als lokales Patchen
        fetchPresence();
    }
}

void setupWebSocket() {
    webSocket.begin(SERVER_HOST, SERVER_PORT, "/ws/presence");
    webSocket.onEvent(onWsEvent);
    webSocket.setReconnectInterval(5000);
}

// ── Stempel-Flow (SCRUM-Stempeldaten-Schutz) ────────────────

void sendStamp(const String& uid) {
    if (!ensureWifi()) { showError("Kein WLAN", 0); return; }

    HTTPClient http;
    String url = "http://" + String(SERVER_HOST) + ":" + String(SERVER_PORT) + "/api/stamp/nfc";
    http.begin(url);
    http.addHeader("Content-Type", "application/json");
    http.setTimeout(5000);

    JsonDocument reqDoc;
    reqDoc["nfcUid"]   = uid;
    reqDoc["deviceId"] = DEVICE_ID;
    String body;
    serializeJson(reqDoc, body);

    int code = http.POST(body);

    if (code == 200) {
        String payload = http.getString();
        lastStampDoc.clear();
        if (deserializeJson(lastStampDoc, payload)) {
            showError("Antwort ungueltig", 0);
            lastStampValid = false;
        } else {
            const char* action = lastStampDoc["action"];
            if (strcmp(action, "stamped") == 0) {
                drawStampBase(lastStampDoc);
                lastStampValid = true;
                detailShown = false;
            } else if (strcmp(action, "assigned") == 0) {
                showAssigned();
                lastStampValid = false;
            } else if (strcmp(action, "frontdesk") == 0) {
                lastStampValid = false;
            } else if (strcmp(action, "unknown") == 0) {
                showUnknown();
                lastStampValid = false;
            } else {
                showError(lastStampDoc["error"] | "Unbekannt", 0);
                lastStampValid = false;
            }
        }
    } else {
        showError("Server nicht erreichbar", code);
        lastStampValid = false;
    }
    http.end();
}

bool readTagUid(String& outUid) {
    nfcBegin();
    rfid.PCD_Init();
    delay(15);
    if (!rfid.PICC_IsNewCardPresent() || !rfid.PICC_ReadCardSerial()) return false;

    String uid = "";
    for (byte i = 0; i < rfid.uid.size; i++) {
        if (i > 0) uid += ":";
        if (rfid.uid.uidByte[i] < 0x10) uid += "0";
        uid += String(rfid.uid.uidByte[i], HEX);
    }
    uid.toUpperCase();
    rfid.PICC_HaltA();
    rfid.PCD_StopCrypto1();
    outUid = uid;
    return true;
}

void loopStampMode() {
    String uid;
    bool seen = readTagUid(uid);
    unsigned long now = millis();

    if (seen) {
        if (!tagCurrentlyPresent || uid != lastUID) {
            // Neue Karte oder andere Karte – einmal stempeln
            lastUID = uid;
            tagFirstSeen = now;
            tagCurrentlyPresent = true;
            detailShown = false;
            sendStamp(uid);
        }
        tagLastSeen = now;

        // SCRUM-285: Long-Hold > 3 s blendet Saldo ein – Display vorher nicht neu zeichnen (kein Flackern)
        if (lastStampValid && !detailShown && (now - tagFirstSeen) >= HOLD_DETAIL_THRESHOLD) {
            drawStampDetail(lastStampDoc);
            detailShown = true;
        }
        return;
    }

    // Keine Karte gesehen
    if (tagCurrentlyPresent) {
        // Karte gerade entfernt – 5 s Anzeige zurückgeben, dann Idle
        if (now - tagLastSeen < IDLE_AFTER_REMOVE) return;

        tagCurrentlyPresent = false;
        lastUID = "";
        lastStampValid = false;
        detailShown = false;
        showReady();
    }
}

// ── Mode-Polling (Webapp-Umschalter) ────────────────────────

void pollMode() {
    if (millis() - lastModeCheck < MODE_POLL_INTERVAL) return;
    lastModeCheck = millis();
    fetchPresence();
}

// ── Setup / Loop ────────────────────────────────────────────

void setup() {
    Serial.begin(115200);

    pinMode(5, OUTPUT);  digitalWrite(5, HIGH);
    pinMode(NFC_SS, OUTPUT); digitalWrite(NFC_SS, HIGH);

    nfcBegin();
    rfid.PCD_Init();
    delay(200);
    byte v = rfid.PCD_ReadRegister(rfid.VersionReg);
    nfcOK = (v != 0x00 && v != 0xFF);

    tftBegin();
    tft.init();
    tft.setRotation(1);
    initColors();
    tft.fillScreen(COL_BG);

    if (!nfcOK) {
        showError("NFC nicht erkannt", 0);
        while (true) delay(1000);
    }

    showStatus("Verbinde WLAN...", COL_YELLOW);
    WiFi.mode(WIFI_STA);
    WiFi.setAutoReconnect(true);
    WiFi.begin(WIFI_SSID, WIFI_PASS);
    int attempts = 0;
    while (WiFi.status() != WL_CONNECTED && attempts < 40) { delay(500); attempts++; }

    // Erste Mode-Abfrage vor dem Rendern entscheidet, welcher Screen erscheint
    if (WiFi.status() == WL_CONNECTED) {
        fetchPresence();
        setupWebSocket();
    }
    if (deviceMode == MODE_STAMP) showReady();
    lastModeCheck = millis();
    lastPresencePoll = millis();
}

void loop() {
    webSocket.loop();
    pollMode();

    if (deviceMode == MODE_FRONTDESK) {
        // SCRUM-296: Auto-Refresh alle 30 s
        if (millis() - lastPresencePoll >= PRESENCE_POLL_INTERVAL) {
            fetchPresence();
            lastPresencePoll = millis();
        }
        delay(50);
        return;
    }

    loopStampMode();
    delay(40);
}
