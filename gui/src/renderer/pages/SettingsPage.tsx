import { useI18n, type Locale } from "@/lib/i18n";
import { Languages } from "lucide-react";

const languageOptions: { value: Locale; label: string }[] = [
  { value: "zh", label: "简体中文" },
  { value: "en", label: "English" }
];

export function SettingsPage() {
  const t = useI18n((s) => s.t);
  const locale = useI18n((s) => s.locale);
  const setLocale = useI18n((s) => s.setLocale);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">{t("settings.title")}</h1>

      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-md bg-secondary">
              <Languages className="size-4 text-muted-foreground" />
            </div>
            <div>
              <p className="text-sm font-medium">{t("settings.language")}</p>
              <p className="text-xs text-muted-foreground">
                {t("settings.language_hint")}
              </p>
            </div>
          </div>
          <select
            value={locale}
            onChange={(e) => setLocale(e.target.value as Locale)}
            className="rounded-md border border-border bg-secondary px-3 py-1.5 text-sm text-foreground outline-none focus:ring-1 focus:ring-ring"
          >
            {languageOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}
