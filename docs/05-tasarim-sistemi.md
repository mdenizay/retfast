# 05 – Tasarım Sistemi

iOS tarzı: harita merkezli, yüzen cam paneller, büyük yuvarlak köşeler, semantik renkler (açık/koyu).

## Katmanlar

| Katman | Dosya | Not |
|---|---|---|
| Belirteçler | `apps/web/src/app/globals.css` | `--bg`, `--surface`, `--label*`, `--fill*`, `--hair`, `--tint`, `--material`; açık/koyu/otomatik. Ham renk yazma. |
| shadcn/ui (Radix) | `apps/web/src/components/ui/*.tsx` | `components.json` ile yönetilir (`bunx shadcn@latest add <bileşen>`); sınıflar belirteçlere bağlı, iOS görünümüne uyarlı. |
| Adaptörler | `apps/web/src/components/ui/index.tsx` | Sayfalar yalnızca `@/components/ui` içinden içe aktarır: `Button`, `Pills` (segmentli kontrol), `Select` (yerel), `ConfirmDialog` … |
| Tema | `apps/web/src/lib/theme.tsx` | `data-theme` + localStorage; ilk boyamadan önce `next/script` ile uygulanır. |

shadcn bileşeni eklerken: `cn` import'u `@/lib/utils`'ten gelmeli; `dark:` varyantları `data-theme="dark"` ile çalışır; ham `bg-white`/`#hex` yerine belirteç kullan.

## Dil

- **Yazı tipi:** Apple cihazlarda sistem yazı tipi (SF Pro), diğerlerinde Inter. Başlık 600–700, gövde 15 px, ölçek `.t-large/.t-title/.t-headline/.t-sub/.t-foot/.t-section/.t-metric`.
- **Malzeme:** `.glass` = `blur(32px) saturate(185%)` + yarı saydam zemin + 0,5 px ince kenarlık + üst vurgu çizgisi. Squircle köşe (`corner-shape`) destekleyen tarayıcılarda.
- **Liste:** `.group` = iOS "inset grouped" (girintili ince ayırıcı). Satırlar renkli daire içinde simge taşır.
- **Renk:** durum renkleri iOS sistem renkleri (`lib/marker-icons.ts`). Kırmızı yalnızca acil durum, yeşil yalnızca onaylı başarı/çevrimiçi.
- **Simge:** lucide-react (stroke 1.8–2). SF Symbols lisansı yalnızca Apple platformları içindir; web/Android'de kullanılmaz.

## Harita

MapLibre GL (paketlenmeden `public/maplibre` altından yüklenir). Alt haritalar `lib/basemaps.ts`: **Koyu, Açık, Şehir** (OpenFreeMap) ve **Uydu**; ayrıca **3B** (eğim + Terrarium arazi + 3B binalar). Tercih `localStorage` (`rf_map`), yoksa tema izlenir.

> **Uydu görüntüsü lisansı:** varsayılan Esri World Imagery'dir ve üretimde ticari kullanım için Esri hesabı/anahtarı gerekir. Canlıya çıkmadan önce `NEXT_PUBLIC_SATELLITE_TILES` ile anahtarlı bir sağlayıcıya (MapTiler, Stadia…) geç veya Esri koşullarını doğrula.
