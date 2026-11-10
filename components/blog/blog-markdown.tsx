import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Renders trusted-but-untrusted Markdown: raw HTML is never rendered. */
export function BlogMarkdown({ text }: { text: string }) {
  return (
    <Markdown
      remarkPlugins={[remarkGfm]}
      skipHtml
      components={{
        // The page title is the only h1, so body headings start at h2.
        h1: ({ children }) => <h2>{children}</h2>,
        a: ({ href, children }) => {
          const external = typeof href === "string" && /^https?:\/\//.test(href);
          return (
            <a
              href={href}
              {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
            >
              {children}
            </a>
          );
        },
        img: () => null,
      }}
    >
      {text}
    </Markdown>
  );
}
