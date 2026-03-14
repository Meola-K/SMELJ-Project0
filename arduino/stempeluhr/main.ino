#include <WiFi.h>
#include <HTTPClient.h>
#include <SPI.h>
#include <MFRC522.h>
#include <TFT_eSPI.h>
#include <ArduinoJson.h>

#define WIFI_SSID "Router-JS"
#define WIFI_PASS "Tor-PrNt01!"
#define SERVER_URL "http://192.168.178.27:3001/api/stamp/nfc"
#define DEVICE_ID "esp32-01"

#define NFC_SS   4
#define NFC_RST  21

MFRC522 rfid(NFC_SS, NFC_RST);
TFT_eSPI tft = TFT_eSPI();
bool nfcOK = false;

void nfcBegin() {
    SPI.end();
    SPI.begin(0, 19, 2, NFC_SS);
}

void tftBegin() {
    SPI.end();
    SPI.begin(18, -1, 23, 5);
}

void showReady() {
    tftBegin();
    tft.fillScreen(TFT_BLACK);
    tft.setTextSize(2);
    tft.setTextColor(TFT_GREEN);
    tft.drawString("BEREIT", 0, 0);
    tft.setTextSize(1);
    tft.setTextColor(TFT_WHITE);
    tft.drawString("IP: " + WiFi.localIP().toString(), 0, 25);
    tft.drawString("Karte auflegen...", 0, 40);
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
    Serial.print("NFC Version: 0x");
    Serial.println(v, HEX);
    nfcOK = (v != 0x00 && v != 0xFF);

    tftBegin();
    tft.init();
    tft.setRotation(1);
    tft.setViewport(0, 1, 160, 128);
    tft.fillScreen(TFT_BLACK);
    tft.setTextSize(1);
    tft.setTextColor(TFT_YELLOW);
    tft.drawString("Verbinde WLAN...", 0, 0);

    WiFi.mode(WIFI_STA);
    WiFi.begin(WIFI_SSID, WIFI_PASS);

    int attempts = 0;
    while (WiFi.status() != WL_CONNECTED && attempts < 40) {
        delay(500);
        attempts++;
    }

    if (WiFi.status() != WL_CONNECTED) {
        tft.fillScreen(TFT_BLACK);
        tft.setTextSize(2);
        tft.setTextColor(TFT_RED);
        tft.drawString("OFFLINE", 0, 0);
        while (true) delay(1000);
    }

    Serial.println("WLAN OK: " + WiFi.localIP().toString());

    if (!nfcOK) {
        tft.fillScreen(TFT_BLACK);
        tft.setTextSize(2);
        tft.setTextColor(TFT_RED);
        tft.drawString("NFC ERR", 0, 0);
        while (true) delay(1000);
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

    Serial.println("UID: " + uid);

    rfid.PICC_HaltA();
    rfid.PCD_StopCrypto1();

    tftBegin();
    tft.fillScreen(TFT_BLACK);
    tft.setTextSize(1);
    tft.setTextColor(TFT_YELLOW);
    tft.drawString("Sende...", 0, 0);

    HTTPClient http;
    http.begin(SERVER_URL);
    http.addHeader("Content-Type", "application/json");
    String body = "{\"uid\":\"" + uid + "\",\"device_id\":\"" DEVICE_ID "\"}";
    int code = http.POST(body);

    tft.fillScreen(TFT_BLACK);

    if (code == 200) {
        String payload = http.getString();
        JsonDocument doc;
        deserializeJson(doc, payload);

        const char* name = doc["name"];
        const char* stempel = doc["stempel"];
        const char* konto = doc["konto"];

        tft.setTextSize(2);
        tft.setTextColor(TFT_GREEN);
        tft.drawString("EINGESTEMPELT", 0, 0);

        tft.setTextSize(1);
        tft.setTextColor(TFT_WHITE);
        tft.drawString(name, 0, 28);

        tft.setTextColor(TFT_CYAN);
        tft.drawString("Zeit: " + String(stempel), 0, 48);

        tft.setTextColor(TFT_YELLOW);
        tft.drawString("Konto: " + String(konto), 0, 63);

        Serial.println(String(name) + " | " + stempel + " | Konto: " + konto);
    } else {
        tft.setTextSize(2);
        tft.setTextColor(TFT_RED);
        tft.drawString("FEHLER", 0, 0);
        tft.setTextSize(1);
        tft.setTextColor(TFT_WHITE);
        tft.drawString("Server: " + String(code), 0, 25);
    }

    http.end();

    delay(3000);
    showReady();
}
