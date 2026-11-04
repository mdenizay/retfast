import { useI18n, type MessageKey } from "@/lib/i18n";
import { PageHeader } from "@/components/common";

const SECTIONS: [MessageKey, MessageKey][] = [
  ["privacy.s1.title", "privacy.s1.body"],
  ["privacy.s2.title", "privacy.s2.body"],
  ["privacy.s3.title", "privacy.s3.body"],
  ["privacy.s4.title", "privacy.s4.body"],
  ["privacy.s5.title", "privacy.s5.body"],
  ["privacy.s6.title", "privacy.s6.body"],
  ["privacy.s7.title", "privacy.s7.body"],
];

export default function PrivacyPage() {
  const { t } = useI18n();
  return (
    <div className="mx-auto max-w-3xl space-y-10 px-4 py-12 sm:px-6">
      <PageHeader title={t("privacy.title")} subtitle={t("privacy.lead")} />
      {SECTIONS.map(([title, body]) => (
        <section key={title}>
          <h2 className="text-headline font-semibold">{t(title)}</h2>
          <p className="mt-2 whitespace-pre-line text-body text-fg-secondary">{t(body)}</p>
        </section>
      ))}
      <p className="text-caption text-fg-muted">{t("privacy.updated")}</p>
    </div>
  );
}
