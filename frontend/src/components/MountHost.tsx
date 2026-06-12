import { useEffect, useRef } from "react";

/** Renders a DOM host and hands it to a plugin's mount(el) function. */
export function MountHost({
  mount,
  className,
}: {
  mount: (el: HTMLElement) => () => void;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    try {
      return mount(ref.current);
    } catch (err) {
      console.error("[workspace] panel mount threw", err);
      return undefined;
    }
  }, [mount]);

  return <div ref={ref} className={className} />;
}
