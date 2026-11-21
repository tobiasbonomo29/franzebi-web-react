import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LegacyPage } from "@/components/LegacyPage";
import { archiveValues, splitPaged, type SearchParams } from "@/lib/legacy/archive";
import { template } from "@/lib/legacy/templates";

type Props = { params: Promise<{ rest?: string[] }>; searchParams: Promise<SearchParams> };

export const metadata: Metadata = { title: { absolute: "Shop – Franzebi Imports – Los Mejores Precios" }, alternates: { canonical: "/shop/" } };

/** /shop/ y /shop/page/N/ (catálogo completo visible; Electrónica queda fuera por RLS). */
export default async function Shop({ params, searchParams }: Props) {
  const [{ rest = [] }, sp] = await Promise.all([params, searchParams]);
  const { segments, page } = splitPaged(rest);
  if (segments.length) notFound();
  const { values, pages } = await archiveValues({
    title: "Shop",
    crumbs: [{ name: "Shop" }],
    categoryIds: null,
    page,
    sp,
    pageHref: (n) => (n > 1 ? `/shop/page/${n}/` : "/shop/"),
  });
  if (page > pages) notFound();
  return <LegacyPage name="shop" values={values} bodyClass={template("shop").bodyClass} />;
}
