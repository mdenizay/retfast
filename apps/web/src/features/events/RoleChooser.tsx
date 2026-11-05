import { MEMBER_ROLES, type MemberRole } from "@/lib/api/types";
import { useI18n } from "@/lib/i18n";
import { ROLE_ICON } from "@/components/stateIcons";
import { cn } from "@/lib/utils";

/** Segmented radio group for the three member roles (native radios: keyboard + screen-reader friendly). */
export function RoleChooser({
  name, value, onChange, label, size = "md", disabled, required,
}: {
  name: string;
  /** null = nothing chosen yet (e.g. approving an application: the organizer must pick). */
  value: MemberRole | null;
  onChange: (r: MemberRole) => void;
  label: string;
  required?: boolean;
  size?: "sm" | "md";
  disabled?: boolean;
}) {
  const { t } = useI18n();
  return (
    <fieldset className="min-w-0" disabled={disabled}>
      <legend className="sr-only">{label}</legend>
      <div className="inline-flex flex-wrap gap-1 rounded-3xl bg-muted p-1" role="presentation">
        {MEMBER_ROLES.map((r) => {
          const Icon = ROLE_ICON[r];
          const checked = value === r;
          return (
            <label
              key={r}
              className={cn(
                "relative flex cursor-pointer items-center gap-1.5 font-medium transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-[-2px] has-[:focus-visible]:outline-focus",
                size === "sm" ? "h-9 px-2.5 text-footnote" : "h-11 px-3 text-body",
                                checked ? "rounded-full bg-primary text-on-primary" : "rounded-full text-fg-secondary hover:text-fg",
              )}
            >
              <input type="radio" className="sr-only" name={name} value={r} checked={checked} required={required} onChange={() => onChange(r)} />
              <Icon className="size-4" aria-hidden />
              {t(`role.${r}`)}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
