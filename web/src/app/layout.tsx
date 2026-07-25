import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Footer, Header } from "@/components/chrome";
import { CopyEnhancer } from "@/components/copy-enhancer";
import { JsonLd } from "@/lib/seo";
import { site, siteUrl } from "@/lib/site";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: `${site.name}: ${site.tagline}`,
    template: `%s`,
  },
  description: site.description,
  applicationName: site.name,
  authors: [{ name: "Pulkit", url: site.repo }],
  keywords: [
    "npm security",
    "supply chain security",
    "slopsquatting",
    "typosquatting",
    "lockfile integrity",
    "install scripts",
    "coding agents",
    "CVE remediation",
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col">
        <JsonLd
          data={[
            {
              "@context": "https://schema.org",
              "@type": "WebSite",
              name: site.name,
              url: site.url,
              description: site.description,
            },
            {
              "@context": "https://schema.org",
              "@type": "SoftwareApplication",
              name: site.name,
              url: site.url,
              applicationCategory: "DeveloperApplication",
              operatingSystem: "macOS, Linux",
              description: site.description,
              license: "https://opensource.org/licenses/MIT",
              sameAs: [site.repo],
            },
          ]}
        />
        <CopyEnhancer />
        <Header />
        <main className="flex-1">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
