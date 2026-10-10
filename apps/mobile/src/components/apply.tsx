import type { EventDetail, Role } from '@retfast/core';
import { useState } from 'react';
import { api, errorCode } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { Button, Card, ErrorBox, Input, Screen, Segmented, Text } from './ui';

export function ApplyView({ ev, onDone }: { ev: EventDetail; onDone: () => void }) {
  const { t, err, date } = useI18n();
  const [role, setRole] = useState<'pilot' | 'retriever' | 'observer'>('pilot');
  const [message, setMessage] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const pending = ev.application?.status === 'pending';

  async function submit() {
    setBusy(true);
    setError(undefined);
    try {
      await api.events.apply(ev.id, { requested_role: role as Role, message, invite_code: code || undefined });
      onDone();
    } catch (e) {
      setError(err(errorCode(e)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Card>
        <Text v="title">{ev.name}</Text>
        <Text v="sub">{[ev.city, ev.country].filter(Boolean).join(', ')} · {date(ev.starts_at)} – {date(ev.ends_at)}</Text>
        {ev.description ? <Text v="body">{ev.description}</Text> : null}
      </Card>
      {pending ? (
        <Card><Text v="body">{t('events.applied')}</Text></Card>
      ) : !ev.applications_open ? (
        <Card><Text v="body">{t('events.applications_closed')}</Text></Card>
      ) : (
        <Card>
          {ev.application?.status === 'rejected' ? <Text v="sub">{t('events.rejected')}</Text> : null}
          <Text v="section">{t('events.apply_as')}</Text>
          <Segmented value={role} onChange={setRole} options={[{ value: 'pilot', label: t('role.pilot') }, { value: 'retriever', label: t('role.retriever') }, { value: 'observer', label: t('role.observer') }]} />
          {ev.visibility === 'private' ? <Input label={t('events.invite_code')} value={code} onChangeText={setCode} autoCapitalize="characters" autoCorrect={false} /> : null}
          <Input label={t('events.apply_message')} value={message} onChangeText={setMessage} multiline />
          <ErrorBox>{error}</ErrorBox>
          <Button variant="primary" size="lg" title={t('events.apply')} loading={busy} onPress={() => void submit()} />
        </Card>
      )}
    </Screen>
  );
}
