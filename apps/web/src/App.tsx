import { Route, Routes } from "react-router";
import { Home } from "./Home";
import { EditorPage } from "./editor/EditorPage";

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/sites/:id" element={<EditorPage />} />
      <Route path="*" element={<p className="p-6 text-sm text-slate-600">Page not found.</p>} />
    </Routes>
  );
}
