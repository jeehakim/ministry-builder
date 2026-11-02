import { Link, Route, Routes } from "react-router";
import { Compass } from "lucide-react";
import { Home } from "./Home";
import { EditorPage } from "./editor/EditorPage";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/sites/:id" element={<EditorPage />} />
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
