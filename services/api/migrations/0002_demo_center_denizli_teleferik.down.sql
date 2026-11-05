UPDATE events
   SET name = 'Çameli Paragliding Demo',
       location_name = 'Çameli, Denizli, Türkiye',
       description = 'Retfast canlı uçuş takibi, etkinlik yönetimi ve pilot konum paylaşımı özelliklerini test etmek amacıyla oluşturulan Çameli demo etkinliği.',
       center_lat = 37.0747,
       center_lon = 29.3450,
       updated_at = now()
 WHERE slug = 'cameli-paragliding-demo' AND is_demo;

UPDATE launch_sites ls
   SET name = 'Yaylacık (Çameli)', lat = NULL, lon = NULL,
       notes = 'Coordinates not verified; configure before use.'
  FROM events e
 WHERE ls.event_id = e.id AND e.slug = 'cameli-paragliding-demo' AND e.is_demo
   AND ls.name = 'Teleferik Üst İstasyon (Bağbaşı)';
