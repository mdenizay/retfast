import type { Announcement } from '@retfast/core';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { Card, Text } from './ui';

/** Etkinlik duyuruları (en yeni 3). */
export function AnnouncementsCard({ eventId }: { eventId: string }) {
  const { t, date } = useI18n();
  const [items, setItems] = useState<Announcement[]>([]);
  useEffect(() => {
    void api.events.announcements(eventId).then((r) => setItems(r.data.slice(0, 3))).catch(() => undefined);
  }, [eventId]);
  if (items.length === 0) return null;
  return (
    <Card>
      <Text v="section">{t('m.announcements')}</Text>
      {items.map((a) => (
        <Text key={a.id} v="body">
          <Text v="headline">{a.title}</Text>
          {a.body ? `\n${a.body}` : ''}
          <Text v="foot">{`\n${date(a.created_at, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`}</Text>
        </Text>
      ))}
    </Card>
  );
}
