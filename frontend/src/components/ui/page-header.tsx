import type { ReactNode } from "react";
import type { IconSource } from "../../plugin-api";
import { AppIcon } from "../AppIcon";

/** Top-level view container (TagView, TrashView, …): centered column with
    consistent padding so every full-page view aligns the same way. */
export function PageContainer({ children }: { children: ReactNode }) {
  return (
    <div className="ui-view mx-auto w-full max-w-[46rem] flex-1 overflow-y-auto overscroll-contain px-4 pt-4 md:px-6 md:pt-8">
      {children}
    </div>
  );
}

/** Page title with a leading icon, matching across full-page views. */
export function PageHeader({
  icon,
  children,
}: {
  icon: IconSource;
  children: ReactNode;
}) {
  return (
    <h1 className="flex items-center gap-1.5 text-2xl font-bold tracking-tight">
      <AppIcon icon={icon} size={20} className="text-faint" />
      {children}
    </h1>
  );
}
