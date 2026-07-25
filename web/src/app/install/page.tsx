import Link from "next/link";
import { Breadcrumbs, Prose } from "@/components/chrome";
import { renderMarkdown } from "@/lib/markdown";
import { breadcrumbs, JsonLd, pageMetadata } from "@/lib/seo";
import { site } from "@/lib/site";
import { META } from "./meta";

export const metadata = pageMetadata({
  title: META.title,
  description: META.description,
  path: "/install",
});

const body = `
## Install script

\`\`\`sh
curl -fsSL https://warden.pulkit.page/install.sh | sh
\`\`\`

This installs \`warden\`, \`wnpm\`, and \`wnpx\`, and offers to place shims ahead of the package managers it detects.

Read the script before running it. That advice applies to every install script, including this one, so it is served as plain text at [warden.pulkit.page/install.sh](/install.sh) and is the same file as [install.sh](https://github.com/pulkitxm/warden/blob/main/install.sh) in the repository.

## From source

This is what the test suite runs against.

\`\`\`sh
git clone https://github.com/pulkitxm/warden
cd warden
make install
bun run build
\`\`\`

You get \`dist/warden\`, \`dist/wnpm\`, and \`dist/wnpx\`. Put them on your \`PATH\`.

## Verify it works

\`\`\`sh
warden --version
warden check express@5
\`\`\`

A clean package exits \`0\`. Try a name that does not exist to see a block.

## Shell completions

\`\`\`sh
warden completions zsh  > ~/.zsh/completions/_warden
warden completions bash > /etc/bash_completion.d/warden
warden completions fish > ~/.config/fish/completions/warden.fish
\`\`\`

Completions cover verbs, flags, and finite flag values, and are generated from the same registry as the help text.

## Interception

The shims sit ahead of \`npm\`, \`pnpm\`, \`yarn\`, \`bun\`, \`npx\`, and \`bunx\`, so installs are vetted without changing how you type. Non-install subcommands pass straight through.

\`\`\`sh
warden config intercept off   # disable
warden config                 # inspect current settings
\`\`\`

## In CI

\`\`\`yaml
- uses: actions/checkout@v5
  with:
    fetch-depth: 0
- uses: oven-sh/setup-bun@v2
- run: curl -fsSL https://warden.pulkit.page/install.sh | sh
- run: warden ci --reporter github --base origin/\${{ github.base_ref }}
\`\`\`

\`fetch-depth: 0\` matters, because \`warden ci\` needs the merge base.

## Uninstall

\`\`\`sh
warden uninstall
\`\`\`

Removes the binaries, shims, config, cache, and shell setup.
`;

export default async function InstallPage() {
  const html = await renderMarkdown(body);
  const trail = [
    { name: "Home", path: "/" },
    { name: "Install", path: "/install" },
  ];
  return (
    <div className="mx-auto max-w-[1400px] px-5 py-12 sm:px-8">
      <JsonLd
        data={[
          {
            "@context": "https://schema.org",
            "@type": "HowTo",
            name: META.title,
            description: META.description,
            step: [
              { "@type": "HowToStep", name: "Install", text: "Run the install script, or build from source with bun run build." },
              { "@type": "HowToStep", name: "Verify", text: "Run warden --version and warden check express@5." },
              { "@type": "HowToStep", name: "Gate CI", text: "Add warden ci --reporter github to your workflow." },
            ],
          },
          breadcrumbs(trail),
        ]}
      />
      <article className="max-w-3xl">
        <Breadcrumbs trail={trail} />
        <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">{META.title}</h1>
        <p className="mt-4 text-lg leading-relaxed text-fog">{META.description}</p>
        <hr className="my-8 border-white/10" />
        <Prose html={html} />
        <p className="mt-10 text-sm text-fog">
          Next:{" "}
          <Link href="/docs/getting-started" className="text-mint hover:text-white">
            getting started
          </Link>{" "}
          or the{" "}
          <Link href="/docs/cli" className="text-mint hover:text-white">
            CLI reference
          </Link>
          . Source on{" "}
          <a
            href={site.repo}
            target="_blank"
            rel="noreferrer"
            className="text-mint hover:text-white"
          >
            GitHub
          </a>
          .
        </p>
      </article>
    </div>
  );
}
