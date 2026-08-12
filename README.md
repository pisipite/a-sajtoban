# K-Monitor sajtófigyelő

Statikus, GitHub Pages-en futó sajtófigyelő. Naponta négyszer lekéri a Google News nyilvános RSS-találatait a `"K-Monitor" OR "K Monitor"` keresésre, összeveti őket a [2014–2026-os referencia-táblázattal](https://docs.google.com/spreadsheets/d/1ew6L7q_sT8C8jro0rFBAlMfx1bZGw0rWSQ5NCbNWqjw/edit?usp=sharing), majd frissíti a webes listát és az RSS-feedet.

## Mit tud?

- az évszám nevű Google Sheets-munkalapok automatikus, fejlécalapú beolvasása;
- új Google News-találatok gyűjtése és duplikációszűrése;
- átlátható, szabályalapú relevanciapontozás;
- a K-Monitor-említés körüli cikkrészlet automatikus kiemelése;
- az elfogadott cikkek mentése a referencia-táblázat `ai` munkalapjára;
- téma és típus kiválasztása a `segéd` munkalap listáiból, új téma felvitelének lehetőségével;
- kattintható összesítő kártyák az új, ellenőrizendő és elfogadott cikkek gyors szűréséhez;
- böngészőben is megőrzött „releváns / kihagyás” döntés és sikertelen mentés utáni automatikus újrapróbálás;
- CSV-export a relevánsnak jelölt tételekből;
- RSS-feed és GitHub issue értesítés az új, erős egyezésekről;
- mobilbarát GitHub Pages felület.

## Éles oldal

Az oldal itt érhető el: https://pisipite.github.io/a-sajtoban/

## Közzététel GitHub Pages-re

1. Hozz létre egy üres GitHub repositoryt, például `kmonitor-hirfigyelo` néven.
2. Másold bele ennek a mappának a teljes tartalmát, commitold, majd pushold a `main` ágra.
3. A repository **Settings → Pages → Build and deployment → Source** mezőjében válaszd a **GitHub Actions** lehetőséget.
4. A **Settings → Actions → General → Workflow permissions** résznél engedélyezd a **Read and write permissions** opciót.
5. Indítsd el kézzel a **Sajtófigyelő frissítése** workflow-t, vagy várd meg a következő ütemezett futást.

Másik repóba telepítve az oldal címe alapértelmezetten `https://FELHASZNÁLÓNÉV.github.io/REPÓNÉV/` lesz.

## Helyi futtatás

```powershell
python -m pip install -r requirements.txt
python scripts/collect.py
python -m http.server 8000
```

Ezután nyisd meg a `http://localhost:8000` címet. A felületet nem érdemes közvetlenül `file://` URL-ről megnyitni, mert a böngésző ilyenkor blokkolhatja a JSON betöltését.

## Finomhangolás

A keresés, a kizárt saját domainek, a referenciaévek és az erős egyezés ponthatára a `data/config.json` fájlban állítható. A pontozás szándékosan magyarázható és konzervatív: a végső relevanciadöntést nem automatizálja.

## Google Táblázatok-mentés

A GitHub Pages önmagában nem kaphat szerkesztési jogot egy Google-táblázathoz, ezért a mentést a táblázat tulajdonosának nevében futó, kis Apps Script-webalkalmazás végzi. Az egyszeri telepítés pontos lépései és a teljes kód a `google-apps-script` mappában találhatók. A telepítésből kapott `/exec` URL-t a `data/integration.json` fájlban kell megadni.

Az `ai` munkalap első mentéskor automatikusan megkapja a következő oszlopokat: dátum, cím, forrás, link, téma, típus, pontszám, szövegkörnyezet, elfogadás ideje és egy technikai azonosító. Az azonosító megakadályozza a duplikált sorokat; egy elfogadás visszavonása törli az adott sort.

## Fontos korlátok

- A Google News RSS nem garantál teljes internetes lefedettséget, és találatai eltérhetnek a normál Google-keresőétől.
- Egyes sajtóoldalak blokkolják az automatikus cikkolvasást. Ilyenkor a felület egyértelműen jelzi, hogy csak a cím vagy a keresőtalálat állt rendelkezésre.
- A kihagyott találatok és a felület helyi döntési állapota a böngészőben marad; az elfogadott találatok közös nyilvántartása az `ai` munkalap.
- E-mailes értesítéshez külső levélküldő szolgáltatás és repository secret szükséges; alapból az RSS és a GitHub issue értesítés működik.
