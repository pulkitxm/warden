import Link from "next/link";
import { Breadcrumbs } from "@/components/chrome";
import { breadcrumbs, JsonLd, pageMetadata } from "@/lib/seo";
import { site } from "@/lib/site";
import { META } from "./meta";

export const metadata = pageMetadata({
  title: META.title,
  description: META.description,
  path: "/contact",
});

const channels = [
  {
    title: "False positive",
    body: "A package you trust was blocked or warned. Include the exact name and version, and the output of warden check <pkg> --json. False positives are bugs and are treated as such.",
    href: `${site.repo}/issues/new`,
    cta: "Open an issue",
  },
  {
    title: "Missed package",
    body: "Warden allowed something it should not have. Include the name and version and what it did. Do not attach malware; a registry coordinate is enough.",
    href: `${site.repo}/issues/new`,
    cta: "Open an issue",
  },
  {
    title: "Security issue in Warden",
    body: "A vulnerability in Warden itself, the installer, or the shims. Report it privately through GitHub security advisories rather than a public issue.",
    href: `${site.repo}/security/advisories/new`,
    cta: "Report privately",
  },
  {
    title: "Everything else",
    body: "Questions, integration help, or an idea for a check. Discussions are the right place, so answers stay searchable for the next person.",
    href: `${site.repo}/discussions`,
    cta: "Start a discussion",
  },
];

export default function ContactPage() {
  const trail = [
    { name: "Home", path: "/" },
    { name: "Contact", path: "/contact" },
  ];
  return (
    <div className="mx-auto max-w-[1400px] px-5 py-12 sm:px-8">
      <JsonLd
        data={[
          {
            "@context": "https://schema.org",
            "@type": "ContactPage",
            name: META.title,
            description: META.description,
            url: `${site.url}/contact`,
            mainEntity: {
              "@type": "Organization",
              name: site.name,
              url: site.url,
              sameAs: [site.repo],
            },
          },
          breadcrumbs(trail),
        ]}
      />
      <div className="max-w-3xl">
        <Breadcrumbs trail={trail} />
        <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">{META.title}</h1>
        <p className="mt-4 text-lg leading-relaxed text-fog">{META.description}</p>
      </div>

      <div className="mt-10 grid max-w-4xl gap-4 md:grid-cols-2">
        {channels.map((channel) => (
          <div
            key={channel.title}
            className="rounded-2xl border border-white/12 bg-navy-soft/50 p-6"
          >
            <h2 className="text-lg font-semibold text-white">{channel.title}</h2>
            <p className="mt-2.5 text-[15px] leading-relaxed text-fog">{channel.body}</p>
            <a
              href={channel.href}
              className="mt-4 inline-block text-sm font-medium text-mint transition hover:text-white"
            >
              {channel.cta} →
            </a>
          </div>
        ))}
      </div>

      <p className="mt-10 max-w-3xl text-sm text-fog">
        Before filing, the{" "}
        <Link href="/docs/troubleshooting" className="text-mint hover:text-white">
          troubleshooting guide
        </Link>{" "}
        covers the common cases, including unsupported lockfiles and exit code 30. The{" "}
        <Link href="/docs/configuration" className="text-mint hover:text-white">
          configuration reference
        </Link>{" "}
        lists every file Warden writes.
      </p>
    </div>
  );
}
