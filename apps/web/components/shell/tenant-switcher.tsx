"use client";

import { useRouter } from "next/navigation";
import { useT } from "../../lib/i18n-client";
import type { SessionTenantDto } from "../../lib/session-dto";
import { Select } from "../ui/select";

/** Shown only when the person belongs to more than one club. */
export function TenantSwitcher({
  tenants,
  currentId,
}: {
  tenants: SessionTenantDto[];
  currentId: string;
}) {
  const t = useT();
  const router = useRouter();
  if (tenants.length < 2) return null;
  return (
    <Select
      label={t("Câu lạc bộ", "Club")}
      value={currentId}
      options={tenants.map((tenant, index) => ({
        value: tenant.tenantId,
        label: t(`Câu lạc bộ ${index + 1}`, `Club ${index + 1}`),
      }))}
      onChange={(e) => router.push(`/c/${e.target.value}`)}
    />
  );
}
