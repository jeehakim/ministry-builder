import type { SectionType } from "@ministry/schema";
import {
  CalendarDays,
  HeartHandshake,
  Info,
  LayoutGrid,
  Mail,
  Quote,
  Sparkles,
  Users,
  type LucideIcon,
} from "lucide-react";

export const SECTION_ICONS: Record<SectionType, LucideIcon> = {
  hero: Sparkles,
  about: Info,
  programs: LayoutGrid,
  events: CalendarDays,
  team: Users,
  stories: Quote,
  give: HeartHandshake,
  contact: Mail,
};

export const SECTION_HINTS: Record<SectionType, string> = {
  hero: "The first thing visitors see",
  about: "Who you are and why it matters",
  programs: "Ministries, services, or projects",
  events: "Service times and upcoming dates",
  team: "Staff, pastors, or board",
  stories: "Testimonials and quotes",
  give: "Links to your giving platform",
  contact: "Email, phone, address, form",
};
