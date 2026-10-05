import { useMemo } from "react";
import { renderMarkdown, type RenderContext } from "../lib/markdown";

export function DocumentView({ markdown, ctx, className = "" }: { markdown: string; ctx?: RenderContext; className?: string }) {
  const html = useMemo(() => renderMarkdown(markdown, ctx), [markdown, ctx]);
  return <article className={`prose-doc px-8 py-8 ${className}`} dangerouslySetInnerHTML={{ __html: html }} />;
}
