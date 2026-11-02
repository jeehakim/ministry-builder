import { Link } from "react-router";
import { Code, GuideLayout, Section, Steps, Tip } from "./GuideLayout";

export function AiGuide() {
  return (
    <GuideLayout
      title="Using the AI copilot"
      intro="The AI writes and designs with you. It never publishes anything on its own, and every field it fills stays editable."
    >
      <Section title="Start with a draft">
        <p>
          Open a site and click <strong>Draft with AI</strong> in the top bar. Tell it about the organization in your own words: who you are, who you
          serve, your programs or ministries, service times, how to give, how to reach you. Rough notes are fine; a pasted flyer works too.
        </p>
        <Steps
          items={[
            <>Pick the page language. Korean, English and Spanish produce the most natural copy; other languages work as well.</>,
            <>Optionally add a <strong>design reference</strong>: a screenshot or flyer you like. The AI borrows its palette and mood, not its content.</>,
            <>Choose <strong>3 variations</strong> to compare three complete pages side by side (different template, colors, hero and tone), or <strong>1 draft</strong> for a single page.</>,
            <>Click <strong>Use this</strong> on the one you like. The others stay available under <strong>Variations</strong> in the top bar.</>,
          ]}
        />
        <Tip>
          The AI only uses facts you gave it. It never invents addresses, phone numbers, dates or giving links; those fields stay empty until you fill
          them. If something is wrong, edit the field; you don't have to regenerate.
        </Tip>
      </Section>

      <Section title="Polish any field">
        <p>
          Every text field has a small sparkle button next to its label. It offers <strong>Improve</strong>, <strong>Shorter</strong>,{" "}
          <strong>Warmer</strong>, <strong>Translate to Korean</strong>, <strong>Translate to English</strong>, and a custom instruction of your own
          such as "mention that childcare is available". The result replaces the field; press Undo in the toast if you prefer the original.
        </p>
      </Section>

      <Section title="Images and design">
        <p>
          Under any uploaded image, <strong>Write alt text</strong> describes it for screen readers and search engines. In <strong>Site &amp; design</strong>,{" "}
          <strong>Match a design reference</strong> turns a photo or a short description ("calm, earthy, like our flyer") into colors, fonts and a hero
          style you can keep adjusting.
        </p>
      </Section>

      <Section title="Other languages">
        <p>
          In <strong>Site &amp; design</strong>, under Languages, choose <strong>Add language</strong> and then <strong>Translate with AI</strong>. The
          whole page is translated and published at its own address, for example <Code>…/en/</Code>, with a language switcher in the header. Switch the
          editor into that language to review every line; images, links and layout stay shared with the primary language.
        </p>
      </Section>

      <Section title="Limits and privacy">
        <p>
          The pill in the top bar shows your AI actions for today out of a daily allowance of 30, resetting at midnight UTC. Drafts, translations and
          field assists each count as one. Your notes are used only to write your page; they are not used to train any model. When it says{" "}
          <strong>AI off</strong>, the platform has no AI key configured and everything else keeps working.
        </p>
        <p>
          Next: <Link className="text-brand underline" to="/guide/publish">publish your page</Link>, then{" "}
          <Link className="text-brand underline" to="/guide/domains">connect your own domain</Link>.
        </p>
      </Section>
    </GuideLayout>
  );
}
