import type { SectionType } from "@ministry/schema";

export type Obj = Record<string, unknown>;

/** Describes the form for a section type; the form component renders it generically. */
export type FieldSpec =
  /** `fixed` text is the same in every language (URLs, email, phone), so translations cannot edit it. */
  | { kind: "text"; key: string; label: string; multiline?: boolean; optional?: boolean; placeholder?: string; hint?: string; fixed?: boolean }
  | { kind: "image"; key: string; label: string }
  /** An optional single link; `blank` is what "Add" creates. */
  | { kind: "link"; key: string; label: string; blank: { label: string; href: string } }
  | { kind: "list"; key: string; label: string; itemLabel: string; titleKey: string; fields: FieldSpec[]; blank: Obj };

const heading: FieldSpec = { kind: "text", key: "heading", label: "Heading" };

const linkFields: FieldSpec[] = [
  { kind: "text", key: "label", label: "Label" },
  { kind: "text", key: "href", label: "Link (https://... or #section)", fixed: true },
];

export const SECTION_LABELS: Record<SectionType, string> = {
  hero: "Hero",
  about: "About",
  programs: "Programs",
  events: "Events & times",
  team: "Team",
  stories: "Stories",
  give: "Give",
  contact: "Contact",
};

export const SECTION_FIELDS: Record<SectionType, FieldSpec[]> = {
  hero: [
    heading,
    { kind: "text", key: "subheading", label: "Subheading", multiline: true },
    { kind: "image", key: "image", label: "Hero image" },
    { kind: "link", key: "primaryCta", label: "primary button", blank: { label: "Get involved", href: "#contact" } },
    { kind: "link", key: "secondaryCta", label: "secondary button", blank: { label: "Learn more", href: "#about" } },
  ],
  about: [
    heading,
    { kind: "text", key: "body", label: "Text", multiline: true, placeholder: "Separate paragraphs with a blank line." },
    { kind: "image", key: "image", label: "Image" },
  ],
  programs: [
    heading,
    {
      kind: "list",
      key: "items",
      label: "Programs",
      itemLabel: "Program",
      titleKey: "title",
      blank: { title: "New program", description: "" },
      fields: [
        { kind: "text", key: "title", label: "Title" },
        { kind: "text", key: "description", label: "Description", multiline: true },
        { kind: "image", key: "image", label: "Image" },
        { kind: "link", key: "link", label: "link", blank: { label: "Learn more", href: "https://" } },
      ],
    },
  ],
  events: [
    heading,
    {
      kind: "list",
      key: "items",
      label: "Events",
      itemLabel: "Event",
      titleKey: "title",
      blank: { title: "New event", when: "", where: "", description: "" },
      fields: [
        { kind: "text", key: "title", label: "Title" },
        { kind: "text", key: "when", label: "When", placeholder: "Sundays 10:30 AM" },
        { kind: "text", key: "where", label: "Where" },
        { kind: "text", key: "description", label: "Description", multiline: true },
      ],
    },
  ],
  team: [
    heading,
    {
      kind: "list",
      key: "members",
      label: "People",
      itemLabel: "Person",
      titleKey: "name",
      blank: { name: "New person", role: "", bio: "" },
      fields: [
        { kind: "text", key: "name", label: "Name" },
        { kind: "text", key: "role", label: "Role" },
        { kind: "text", key: "bio", label: "Bio", multiline: true },
        { kind: "image", key: "photo", label: "Photo" },
      ],
    },
  ],
  stories: [
    heading,
    {
      kind: "list",
      key: "items",
      label: "Stories",
      itemLabel: "Story",
      titleKey: "attribution",
      blank: { quote: "A short story or testimonial.", attribution: "" },
      fields: [
        { kind: "text", key: "quote", label: "Quote", multiline: true },
        { kind: "text", key: "attribution", label: "Attribution" },
      ],
    },
  ],
  give: [
    heading,
    { kind: "text", key: "body", label: "Text", multiline: true },
    {
      kind: "list",
      key: "links",
      label: "Giving links",
      itemLabel: "Link",
      titleKey: "label",
      blank: { label: "Give online", href: "https://" },
      fields: linkFields,
    },
  ],
  contact: [
    heading,
    { kind: "text", key: "email", label: "Email", fixed: true, hint: "Messages from the contact form are emailed here" },
    { kind: "text", key: "phone", label: "Phone", fixed: true },
    { kind: "text", key: "address", label: "Address", multiline: true },
    {
      kind: "text",
      key: "formEndpoint",
      label: "Custom form endpoint (advanced, optional)",
      hint: "Leave empty to use the built-in form that emails the address above",
      optional: true,
      fixed: true,
      placeholder: "https://api.web3forms.com/submit",
    },
    {
      kind: "list",
      key: "social",
      label: "Social links",
      itemLabel: "Link",
      titleKey: "label",
      blank: { label: "Facebook", href: "https://" },
      fields: linkFields,
    },
  ],
};
