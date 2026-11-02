import { Link } from "react-router";
import { Code, GuideLayout, Section, Steps, Tip } from "./GuideLayout";

export function FundraisingGuide() {
  return (
    <GuideLayout
      title="Fundraising campaigns"
      intro="A campaign is a page on your own site with a story, a goal and a live progress bar. Giving goes through the processor you already use; Ministry Sites never holds the money."
    >
      <Section title="How it fits together">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            Campaigns live under <strong>Fundraising</strong> in the dashboard, next to <strong>Sites</strong>. Each one belongs to a site and is published with it.
          </li>
          <li>
            An <strong>active</strong> campaign gets a page at <Code>yoursite/give/campaign-name/</Code> in every language of the site, and a card in the site's <strong>Give</strong> section.
          </li>
          <li>
            The page links out to your giving form (Zeffy, Givebutter, PayPal, Tithe.ly) with <Code>?campaign=…</Code> and the chosen amount added to the link.
          </li>
          <li>
            You record gifts as they come in, by hand or from a CSV. The progress bar and the optional donor wall are rendered from those records each time you publish.
          </li>
        </ul>
      </Section>

      <Section title="Launch a campaign">
        <Steps
          items={[
            <>
              Open <strong>Fundraising</strong> and click <strong>New campaign</strong>. Give it a title and, if you like, a goal.
            </>,
            <>
              Click <strong>Draft with AI</strong>, describe what the money does and who it helps, and edit the result. Add a cover image.
            </>,
            <>
              Paste your processor's form link under <strong>Giving link</strong>. Make one form per campaign on their side so their reports match yours.
            </>,
            <>
              Set the status to <strong>Active</strong>, save, then open the site editor and <strong>Publish</strong>. Share the campaign link from the Publishing card.
            </>,
          ]}
        />
        <Tip>
          The published page shows the numbers as of the last publish. After recording gifts, publish the site again to update the bar.
        </Tip>
      </Section>

      <Section title="Recording gifts">
        <p>
          <strong>Add gift</strong> records one gift. With an email address, the donor receives your thank-you note through your email sender (see the{" "}
          <Link className="text-brand underline" to="/guide/email">
            email guide
          </Link>
          ). Tick "agreed to be listed" when the donor wants to appear on the wall; they are shown as first name and initial only.
        </p>
        <p>
          <strong>Import CSV</strong> takes an export from your processor: columns <Code>amount</Code> (required), <Code>name</Code>, <Code>email</Code>, <Code>date</Code>,{" "}
          <Code>source</Code>, <Code>public</Code> and <Code>note</Code>, up to 2,000 rows. If any row has a problem, nothing is imported and the rows are listed. Imported gifts never trigger
          a thank-you email.
        </p>
      </Section>

      <Section title="Choosing which cards appear">
        <p>
          In the editor, select the <strong>Give</strong> section. By default every active campaign gets a card. Tick specific campaigns to show only those, in that order.
        </p>
      </Section>
    </GuideLayout>
  );
}
