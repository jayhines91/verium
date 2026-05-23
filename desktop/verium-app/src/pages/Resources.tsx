import {
  BookOpen,
  Download,
  Globe,
  HardDriveDownload,
  PackageOpen,
  ScanSearch,
  Twitter,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/Card";
import { ExternalLinkButton } from "@/components/ExternalLinkButton";
import {
  BOOTSTRAP_URL_ARM,
  BOOTSTRAP_URL_X64,
  CDN_RELEASES,
  CDN_ROOT,
  COMMUNITY_TWITTER,
  COMMUNITY_WEBSITE,
  DOCS_DOWNLOADS,
  DOCS_HOME,
  EXPLORER_HOME,
} from "@/lib/verium-links";
import releases from "@/lib/releases-manifest.json";

interface ResourceCardProps {
  icon: typeof Globe;
  title: string;
  description: string;
  href: string;
  cta: string;
}

function ResourceCard({ icon: Icon, title, description, href, cta }: ResourceCardProps) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-fg-muted" />
          <CardTitle className="!normal-case !tracking-normal !text-base">
            {title}
          </CardTitle>
        </div>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <ExternalLinkButton href={href}>{cta}</ExternalLinkButton>
      </CardContent>
    </Card>
  );
}

export function Resources() {
  const latest = releases.latest;
  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Verium {latest.version}</CardTitle>
          <CardDescription>
            Latest official wallet release. Download the installer that matches
            your operating system from the Vericonomy downloads page.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <ExternalLinkButton href={DOCS_DOWNLOADS} variant="primary">
            Open Downloads page
          </ExternalLinkButton>
          <ExternalLinkButton href={CDN_RELEASES}>
            Browse CDN releases
          </ExternalLinkButton>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <ResourceCard
          icon={ScanSearch}
          title="Block Explorer"
          description="Browse blocks, transactions, peers, and the rich list on the official Verium explorer."
          href={EXPLORER_HOME}
          cta="Open explorer"
        />
        <ResourceCard
          icon={HardDriveDownload}
          title="Chain Bootstrap"
          description="Download a fresh snapshot of the chain to speed up the initial sync on a new install."
          href={BOOTSTRAP_URL_X64}
          cta="Download (x64)"
        />
        <ResourceCard
          icon={HardDriveDownload}
          title="Chain Bootstrap (ARM)"
          description="Same snapshot built for ARM hosts such as Raspberry Pi."
          href={BOOTSTRAP_URL_ARM}
          cta="Download (ARM)"
        />
        <ResourceCard
          icon={BookOpen}
          title="Documentation"
          description="Setup guides, build instructions, and configuration reference."
          href={DOCS_HOME}
          cta="Read the docs"
        />
        <ResourceCard
          icon={PackageOpen}
          title="Files index"
          description="Raw CDN listing of release assets, bootstraps, and the VERSION_VRM.json feed."
          href={CDN_ROOT}
          cta="Browse files"
        />
        <ResourceCard
          icon={Download}
          title="Official downloads"
          description="Per-OS installers and zips for the latest Verium wallet release."
          href={DOCS_DOWNLOADS}
          cta="Open Downloads"
        />
        <ResourceCard
          icon={Globe}
          title="Vericonomy"
          description="Project website with news, mission, and ecosystem links."
          href={COMMUNITY_WEBSITE}
          cta="Open website"
        />
        <ResourceCard
          icon={Twitter}
          title="Twitter / X"
          description="Announcements and community updates from @vericonomy."
          href={COMMUNITY_TWITTER}
          cta="Open profile"
        />
      </div>
    </div>
  );
}
