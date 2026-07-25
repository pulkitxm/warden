import { classifyTerminal } from "@/lib/terminal";

export function Terminal({ output, className = "" }: { output: string; className?: string }) {
  const lines = classifyTerminal(output);
  return (
    <div className={`terminal-block overflow-x-auto rounded-xl border border-white/12 ${className}`}>
      <pre className="terminal">
        <code>
          {lines.map((tokens, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: terminal lines are positional
            <span className="line" key={index}>
              {tokens.map((token, position) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: tokens are positional within a line
                <span className={token.cls} key={position}>
                  {token.text}
                </span>
              ))}
              {"\n"}
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}
