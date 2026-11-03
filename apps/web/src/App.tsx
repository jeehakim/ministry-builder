import { Link, Route, Routes } from "react-router";
import { Compass } from "lucide-react";
import { Home } from "./Home";
import { EditorPage } from "./editor/EditorPage";
import { CampaignPage } from "./fundraising/CampaignPage";
import { FundraisingPage } from "./fundraising/FundraisingPage";
import { FundraisingGuide } from "./guides/FundraisingGuide";
import { AiGuide } from "./guides/AiGuide";
import { DomainsGuide } from "./guides/DomainsGuide";
import { EmailGuide } from "./guides/EmailGuide";
import { InvitePage } from "./invite/InvitePage";
import { PublishGuide } from "./guides/PublishGuide";
import { SettingsPage } from "./settings/SettingsPage";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/sites/:id" element={<EditorPage />} />
      <Route path="/sites/:id/settings" element={<SettingsPage />} />
      <Route path="/fundraising" element={<FundraisingPage />} />
      <Route path="/sites/:id/fundraising/:cid" element={<CampaignPage />} />
      <Route path="/guide/fundraising" element={<FundraisingGuide />} />
      <Route path="/invite/:token" element={<InvitePage />} />
      <Route path="/guide/ai" element={<AiGuide />} />
      <Route path="/guide/publish" element={<PublishGuide />} />
      <Route path="/guide/domains" element={<DomainsGuide />} />
      <Route path="/guide/email" element={<EmailGuide />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

function NotFound() {
  return (
    <div className="flex min-h-dvh items-center justify-center p-6">
      <Empty className="max-w-sm">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Compass />
          </EmptyMedia>
          <EmptyTitle>Page not found</EmptyTitle>
          <EmptyDescription>That link does not go anywhere. Your sites are one click away.</EmptyDescription>
        </EmptyHeader>
        <Button asChild variant="outline">
          <Link to="/">Back to your sites</Link>
        </Button>
      </Empty>
    </div>
  );
}
