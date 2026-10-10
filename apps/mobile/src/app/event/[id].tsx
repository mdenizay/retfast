import type { EventDetail } from '@retfast/core';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ApplyView } from '../../components/apply';
import { PilotView } from '../../components/pilot';
import { RetrieverView } from '../../components/retriever';
import { StaffView } from '../../components/staff';
import { ErrorBox, Loading, Screen } from '../../components/ui';
import { api, errorCode } from '../../lib/api';
import { useI18n } from '../../lib/i18n';

export default function EventScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { err } = useI18n();
  const [ev, setEv] = useState<EventDetail | null>(null);
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    try {
      setEv(await api.events.get(id));
    } catch (e) {
      setError(err(errorCode(e)));
    }
  }, [id, err]);
  useEffect(() => void load(), [load]);

  if (error) return <Screen><ErrorBox>{error}</ErrorBox></Screen>;
  if (!ev) return <Loading />;
  const role = ev.membership?.role;
  return (
    <>
      <Stack.Screen options={{ title: ev.name, headerShown: !role }} />
      {role === 'pilot' ? <PilotView ev={ev} /> : role === 'retriever' ? <RetrieverView ev={ev} /> : role ? <StaffView ev={ev} /> : <ApplyView ev={ev} onDone={load} />}
    </>
  );
}
