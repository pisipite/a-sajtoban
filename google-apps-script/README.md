# Google Táblázatok-mentés beállítása

Ez a kis Apps Script fogadja a GitHub Pages „Releváns” gombjának kérését, és az elfogadott cikket az `ai` munkalapra írja. A felület téma- és típusválasztékát a `segéd` munkalap azonos nevű oszlopaiból adja vissza. Az újonnan beírt témát az első elfogadáskor a `segéd` lap témaoszlopához is hozzáadja. Az azonosító alapján nem hoz létre duplikált sort; egy döntés visszavonásakor csak a hozzá tartozó sort törli.

1. Nyisd meg a sajtófigyelő Google-táblázatát szerkesztőként.
2. Válaszd a **Bővítmények → Apps Script** menüpontot.
3. A szerkesztőben a `Code.gs` tartalmát cseréld le az ebben a mappában lévő `Code.gs` tartalmára, majd mentsd el.
4. Válaszd a **Telepítés → Új telepítés → Webalkalmazás** lehetőséget.
5. A végrehajtó legyen **én**, a hozzáférés pedig **bárki**.
6. Másold ki a `/exec` végű webalkalmazás-URL-t, és írd a `data/integration.json` fájl `google_apps_script_url` mezőjébe.

A webalkalmazás első telepítésekor a Google engedélyt kér a táblázat módosítására. A program az üres `ai` munkalapon automatikusan létrehozza a fejlécet. A `segéd` munkalap első sorában `téma` és `típus` fejlécnek kell szerepelnie.
