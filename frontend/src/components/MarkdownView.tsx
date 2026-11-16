import type { ReactNode } from "react";

interface MarkdownViewProps {
  content: string;
  placeholder?: string;
  onCiteClick?: (index: number) => void;
}

function renderInline(text: string, keyPrefix: string, onCiteClick?: (index: number) => void): ReactNode[] {
  // Match inline code, bold, italic, markdown links, or RAG citation pills [1]
  const tokenRegex = /(`[^`]+`|\*\*[^*]+?\*\*|\*[^*]+?\*|\[[^\]]+\]\(https?:\/\/[^)]+\)|\[\d+\])/g;
  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let idx = 0;

  while ((match = tokenRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    const token = match[0];
    const k = `${keyPrefix}-${idx++}`;

    if (token.startsWith("`") && token.endsWith("`")) {
      parts.push(<code key={k}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith("**") && token.endsWith("**")) {
      parts.push(<strong key={k}>{renderInline(token.slice(2, -2), k, onCiteClick)}</strong>);
    } else if (token.startsWith("*") && token.endsWith("*")) {
      parts.push(<em key={k}>{token.slice(1, -1)}</em>);
    } else if (/^\[\d+\]$/.test(token)) {
      const citeNum = Number(token.slice(1, -1));
      parts.push(
        <button
          type="button"
          className="md-cite"
          key={k}
          title={onCiteClick ? `点击跳转查看第 ${citeNum} 条攻略原文` : undefined}
          onClick={() => onCiteClick?.(citeNum)}
          style={{ border: 0, cursor: onCiteClick ? "pointer" : "default" }}
        >
          {token}
        </button>
      );
    } else {
      const linkMatch = token.match(/^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/);
      if (linkMatch) {
        parts.push(
          <a key={k} href={linkMatch[2]} target="_blank" rel="noreferrer">
            {linkMatch[1]}
          </a>
        );
      } else {
        parts.push(token);
      }
    }
    lastIndex = tokenRegex.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
  return parts;
}

function parseTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function isTableSeparatorRow(line: string): boolean {
  const cells = parseTableRow(line);
  return cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c));
}

export function MarkdownView({ content, placeholder, onCiteClick }: MarkdownViewProps) {
  if (!content.trim()) {
    return <p className="md-placeholder">{placeholder || ""}</p>;
  }

  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let blockKey = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i++;
      continue;
    }

    // Fenced code block
    if (line.trim().startsWith("```")) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++;
      blocks.push(
        <pre key={`b-${blockKey++}`}>
          <code>{codeLines.join("\n")}</code>
        </pre>
      );
      continue;
    }

    // Headings
    const headingMatch = line.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const body = renderInline(headingMatch[2], `h-${blockKey}`, onCiteClick);
      const k = `b-${blockKey++}`;
      if (level === 1) blocks.push(<h2 key={k}>{body}</h2>);
      else if (level === 2) blocks.push(<h3 key={k}>{body}</h3>);
      else blocks.push(<h4 key={k}>{body}</h4>);
      i++;
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,})$/.test(line.trim())) {
      blocks.push(<hr key={`b-${blockKey++}`} />);
      i++;
      continue;
    }

    // Blockquote
    if (line.trim().startsWith(">")) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith(">")) {
        quoteLines.push(lines[i].trim().replace(/^>\s?/, ""));
        i++;
      }
      blocks.push(
        <blockquote key={`b-${blockKey++}`}>{renderInline(quoteLines.join(" "), `q-${blockKey}`, onCiteClick)}</blockquote>
      );
      continue;
    }

    // Unordered list
    if (/^\s*[-*•]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*•]\s+/, ""));
        i++;
      }
      blocks.push(
        <ul key={`b-${blockKey++}`}>
          {items.map((item, idx) => (
            <li key={idx}>{renderInline(item, `ul-${blockKey}-${idx}`, onCiteClick)}</li>
          ))}
        </ul>
      );
      continue;
    }

    // Ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ""));
        i++;
      }
      blocks.push(
        <ol key={`b-${blockKey++}`}>
          {items.map((item, idx) => (
            <li key={idx}>{renderInline(item, `ol-${blockKey}-${idx}`, onCiteClick)}</li>
          ))}
        </ol>
      );
      continue;
    }

    // Markdown GFM Table (handles standard multi-line tables)
    if (/^\s*\|.+\|\s*$/.test(line) && i + 1 < lines.length && isTableSeparatorRow(lines[i + 1])) {
      const headers = parseTableRow(line);
      i += 2; // skip header + separator
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|.+\|\s*$/.test(lines[i])) {
        rows.push(parseTableRow(lines[i]));
        i++;
      }
      const k = `b-${blockKey++}`;
      blocks.push(
        <div className="md-table-wrap" key={k}>
          <table className="md-table">
            <thead>
              <tr>
                {headers.map((h, hIdx) => (
                  <th key={hIdx}>{renderInline(h, `${k}-th-${hIdx}`, onCiteClick)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, rIdx) => (
                <tr key={rIdx}>
                  {headers.map((_, cIdx) => (
                    <td key={cIdx}>{renderInline(r[cIdx] ?? "", `${k}-td-${rIdx}-${cIdx}`, onCiteClick)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    // Paragraph (combine consecutive plain lines)
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !lines[i].trim().startsWith("```") &&
      !/^(#{1,4})\s+/.test(lines[i]) &&
      !lines[i].trim().startsWith(">") &&
      !/^\s*[-*•]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i]) &&
      !(/^\s*\|.+\|\s*$/.test(lines[i]) && i + 1 < lines.length && isTableSeparatorRow(lines[i + 1]))
    ) {
      paraLines.push(lines[i].trim());
      i++;
    }
    blocks.push(<p key={`b-${blockKey++}`}>{renderInline(paraLines.join(" "), `p-${blockKey}`, onCiteClick)}</p>);
  }

  return <div className="md-body">{blocks}</div>;
}
