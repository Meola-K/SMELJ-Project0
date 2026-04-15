#include <WiFi.h>
#include <HTTPClient.h>
#include <SPI.h>
#include <MFRC522.h>
#include <TFT_eSPI.h>
#include <ArduinoJson.h>

#define WIFI_SSID "J"
#define WIFI_PASS "12345678J"
#define SERVER_URL "http://172.20.10.2:3001/api/stamp/nfc"
#define DEVICE_ID "esp32-01"

#define NFC_SS   4
#define NFC_RST  21
#define WIFI_RETRY_INTERVAL 30000
#define SCAN_COOLDOWN 2500

MFRC522 rfid(NFC_SS, NFC_RST);
TFT_eSPI tft = TFT_eSPI();
bool nfcOK = false;
unsigned long lastWifiCheck = 0;
String lastUID = "";
unsigned long lastScanTime = 0;

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
    tft.setTextColor(color, TFT_BLACK);
    int w = tft.textWidth(txt);
    tft.drawString(txt, (tft.width() - w) / 2, y);
}

void drawLine(int y) {
    for (int x = 10; x < tft.width() - 10; x += 2)
        tft.drawPixel(x, y, tft.color565(40, 40, 60));
}

void showReady() {
    tftBegin();
    tft.fillScreen(TFT_BLACK);
    drawCentered("STEMPELUHR", 8, 2, tft.color565(130, 70, 255));
    drawLine(30);

    tft.setTextSize(1);
    if (WiFi.status() == WL_CONNECTED) {
        tft.setTextColor(tft.color565(80, 200, 80), TFT_BLACK);
        String ip = WiFi.localIP().toString();
        int w = tft.textWidth(ip.c_str());
        tft.drawString(ip, (tft.width() - w) / 2, 38);
    } else {
        drawCentered("OFFLINE", 38, 1, TFT_RED);
    }

    drawLine(52);
    drawCentered("Karte auflegen", 64, 1, tft.color565(160, 160, 180));

    tft.fillCircle(tft.width() / 2, 95, 12, tft.color565(25, 25, 40));
    tft.drawCircle(tft.width() / 2, 95, 12, tft.color565(130, 70, 255));
    tft.drawCircle(tft.width() / 2, 95, 8, tft.color565(80, 50, 160));
    tft.drawCircle(tft.width() / 2, 95, 4, tft.color565(50, 30, 100));
}

void showStatus(const char* msg, uint16_t color) {
    tftBegin();
    tft.fillScreen(TFT_BLACK);
    drawCentered(msg, 50, 1, color);
}

void showStamp(JsonDocument& doc) {
    const char* type = doc["type"];
    bool isIn = strcmp(type, "in") == 0;
    int todayMins = doc["todayMinutes"];
    int balance = doc["balance"];
    const char* firstName = doc["user"]["firstName"];
    const char* lastName = doc["user"]["lastName"];
    const char* timeStr = doc["time"];

    tftBegin();
    tft.fillScreen(TFT_BLACK);

    uint16_t accent = isIn ? tft.color565(50, 205, 50) : tft.color565(255, 140, 50);
    drawCentered(isIn ? "EINSTEMPELN" : "AUSSTEMPELN", 4, 2, accent);

    for (int x = 0; x < tft.width(); x++)
        tft.drawPixel(x, 26, accent);

    String name = String(firstName) + " " + String(lastName);
    drawCentered(name.c_str(), 34, 1, TFT_WHITE);

    String zeit = fmtTime(timeStr);
    drawCentered(zeit.c_str(), 48, 1, tft.color565(150, 150, 170));

    drawLine(62);

    tft.setTextSize(1);
    tft.setTextColor(tft.color565(120, 120, 140), TFT_BLACK);
    tft.drawString("Heute:", 8, 72);
    String todayStr = fmtMin(todayMins);
    tft.setTextColor(TFT_CYAN, TFT_BLACK);
    tft.drawString(todayStr, tft.width() - 8 - tft.textWidth(todayStr.c_str()), 72);

    tft.setTextColor(tft.color565(120, 120, 140), TFT_BLACK);
    tft.drawString("Konto:", 8, 86);
    uint16_t balColor = balance >= 0 ? tft.color565(50, 205, 50) : TFT_RED;
    String balStr = fmtMin(balance);
    tft.setTextColor(balColor, TFT_BLACK);
    tft.drawString(balStr, tft.width() - 8 - tft.textWidth(balStr.c_str()), 86);

    const char* warning = doc["warning"];
    if (warning && strlen(warning) > 0) {
        drawLine(100);
        drawCentered(warning, 108, 1, TFT_YELLOW);
    }
}

void showAssigned() {
    tftBegin();
    tft.fillScreen(TFT_BLACK);
    drawCentered("ZUGEWIESEN", 30, 2, TFT_CYAN);
    drawLine(55);
    drawCentered("NFC-Tag registriert", 65, 1, TFT_WHITE);
}

void showUnknown() {
    tftBegin();
    tft.fillScreen(TFT_BLACK);
    drawCentered("UNBEKANNT", 30, 2, TFT_RED);
    drawLine(55);
    drawCentered("Tag nicht zugewiesen", 65, 1, tft.color565(180, 180, 180));
}

void showError(const char* msg, int httpCode) {
    tftBegin();
    tft.fillScreen(TFT_BLACK);
    drawCentered("FEHLER", 30, 2, TFT_RED);
    drawLine(55);
    drawCentered(msg, 65, 1, tft.color565(180, 180, 180));
    if (httpCode > 0) {
        String code = "HTTP " + String(httpCode);
        drawCentered(code.c_str(), 80, 1, tft.color565(120, 120, 140));
    }
}

bool ensureWifi() {
    if (WiFi.status() == WL_CONNECTED) return true;
    if (millis() - lastWifiCheck < WIFI_RETRY_INTERVAL && lastWifiCheck > 0) return false;
    lastWifiCheck = millis();

    WiFi.disconnect();
    WiFi.begin(WIFI_SSID, WIFI_PASS);
    int attempts = 0;
    while (WiFi.status() != WL_CONNECTED && attempts < 20) {
        delay(500);
        attempts++;
    }
    return WiFi.status() == WL_CONNECTED;
}

void setup() {
    Serial.begin(115200);

    pinMode(5, OUTPUT);
    digitalWrite(5, HIGH);
    pinMode(NFC_SS, OUTPUT);
    digitalWrite(NFC_SS, HIGH);

    nfcBegin();
    rfid.PCD_Init();
    delay(200);
    byte v = rfid.PCD_ReadRegister(rfid.VersionReg);
    nfcOK = (v != 0x00 && v != 0xFF);

    tftBegin();
    tft.init();
    tft.setRotation(1);
    tft.fillScreen(TFT_BLACK);

    if (!nfcOK) {
        showError("NFC nicht erkannt", 0);
        while (true) delay(1000);
    }

    showStatus("Verbinde WLAN...", TFT_YELLOW);
    WiFi.mode(WIFI_STA);
    WiFi.setAutoReconnect(true);
    WiFi.begin(WIFI_SSID, WIFI_PASS);

    int attempts = 0;
    while (WiFi.status() != WL_CONNECTED && attempts < 40) {
        delay(500);
        attempts++;
    }

    showReady();
}

void loop() {
    nfcBegin();
    rfid.PCD_Init();
    delay(30);

    if (!rfid.PICC_IsNewCardPresent() || !rfid.PICC_ReadCardSerial()) {
        delay(100);
        return;
    }

    String uid = "";
    for (byte i = 0; i < rfid.uid.size; i++) {
        if (i > 0) uid += ":";
        if (rfid.uid.uidByte[i] < 0x10) uid += "0";
        uid += String(rfid.uid.uidByte[i], HEX);
    }
    uid.toUpperCase();

    rfid.PICC_HaltA();
    rfid.PCD_StopCrypto1();

    if (uid == lastUID && millis() - lastScanTime < SCAN_COOLDOWN) return;
    lastUID = uid;
    lastScanTime = millis();

    if (!ensureWifi()) {
        showError("Kein WLAN", 0);
        delay(2000);
        showReady();
        return;
    }

    showStatus("Sende...", TFT_YELLOW);

    HTTPClient http;
    http.begin(SERVER_URL);
    http.addHeader("Content-Type", "application/json");
    http.setTimeout(5000);

    JsonDocument reqDoc;
    reqDoc["nfcUid"] = uid;
    reqDoc["deviceId"] = DEVICE_ID;
    String body;
    serializeJson(reqDoc, body);

    int code = http.POST(body);

    if (code == 200) {
        String payload = http.getString();
        JsonDocument doc;
        if (deserializeJson(doc, payload)) {
            showError("Antwort ungueltig", 0);
        } else {
            const char* action = doc["action"];
            if (strcmp(action, "stamped") == 0) showStamp(doc);
            else if (strcmp(action, "assigned") == 0) showAssigned();
            else if (strcmp(action, "unknown") == 0) showUnknown();
            else showError(doc["error"] | "Unbekannt", 0);
        }
    } else {
        showError("Server nicht erreichbar", code);
    }

    http.end();
    delay(3000);
    showReady();
}
