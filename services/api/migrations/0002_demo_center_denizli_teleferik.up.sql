-- Move the demo event to the Denizli Teleferik upper station (Bağbaşı),
-- OpenStreetMap "Denizli Teleferik Üst İstasyon" (37.70804, 29.13508), ~1300 m.
-- Slug stays the same so existing links and app state keep working.
UPDATE events
   SET name = 'Denizli Teleferik Paragliding Demo',
       location_name = 'Denizli Teleferik, Bağbaşı, Denizli, Türkiye',
       description = 'Retfast canlı uçuş takibi, etkinlik yönetimi ve pilot konum paylaşımı özelliklerini test etmek amacıyla oluşturulan Denizli Teleferik demo etkinliği.',
       center_lat = 37.70804,
       center_lon = 29.13508,
       updated_at = now()
 WHERE slug = 'cameli-paragliding-demo' AND is_demo;

UPDATE launch_sites ls
   SET name = 'Teleferik Üst İstasyon (Bağbaşı)',
       lat = 37.70804,
       lon = 29.13508,
       notes = 'From OpenStreetMap (aerialway station); not verified on site.'
  FROM events e
 WHERE ls.event_id = e.id AND e.slug = 'cameli-paragliding-demo' AND e.is_demo
   AND ls.name = 'Yaylacık (Çameli)'
   AND NOT EXISTS (SELECT 1 FROM launch_sites x WHERE x.event_id = e.id AND x.name = 'Teleferik Üst İstasyon (Bağbaşı)');
