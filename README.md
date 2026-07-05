# Leaf2 Usage Board

Local high-contrast dashboard for a BOOX Leaf2 or any E Ink browser.

## Run

```powershell
npm start
```

Open the LAN URL printed by the server on the Leaf2 browser.

## Configure

Copy `config.example.json` to `config.json` and adjust the location or port.

```json
{
  "port": 8765,
  "location": {
    "label": "Taipei",
    "latitude": 25.033,
    "longitude": 121.5654,
    "timezone": "Asia/Taipei"
  },
  "refreshSeconds": 180
}
```

Weather is fetched from Open-Meteo without an API key.
