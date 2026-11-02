import { Link } from "react-router";
import { Code, GuideLayout, Section, Steps, Tip } from "./GuideLayout";

export function PublishGuide() {
  return (
    <GuideLayout title="Publishing and hosting" intro="Your page is plain, fast HTML. You can let us host it for free or take the files anywhere.">
      <Section title="Publish on Ministry Sites (one click)">
        <Steps
          items={[
            <>Click <strong>Publish</strong> in the top bar, then <strong>Publish now</strong>.</>,
            <>Your page is live within seconds at <Code>sites.shofar.io/your-name/</Code>, with a separate address for each language you added.</>,
            <>Edit anything later and click <strong>Publish changes</strong>. The live page updates within a minute.</>,
          ]}
        />
        <p>
          <strong>Unpublish</strong> takes the page offline without deleting your work.
        </p>
      </Section>

      <Section title="The contact form">
        <p>
          Add an email address in the <strong>Contact</strong> section and a contact form appears on the page in every language. Messages are delivered
          to that address and also kept under <strong>Messages</strong> in the top bar, with a Reply button. The address itself is never printed on the
          page unless you turn on <strong>Show the email address on the page</strong>.
        </p>
      </Section>

      <Section title="Host it yourself (free, on Cloudflare)">
        <p>Prefer to own the hosting? The ZIP contains everything.</p>
        <Steps
          items={[
            <>In the Publish dialog, open <strong>Host it yourself</strong> and <strong>Download ZIP</strong>.</>,
            <>Go to <a className="text-brand underline" href="https://cloudflare.com/drop" target="_blank" rel="noreferrer">cloudflare.com/drop</a> and drag the ZIP onto the page. You get a live preview link immediately.</>,
            <>Click <strong>Claim</strong>, create a free Cloudflare account, and the site is yours for good.</>,
            <>To update it later, download a new ZIP and drop it again.</>,
          ]}
        />
        <Tip>The contact form in a self-hosted copy still delivers through Ministry Sites, so messages keep arriving in your inbox.</Tip>
        <p>
          Next: <Link className="text-brand underline" to="/guide/domains">use your own domain</Link>.
        </p>
      </Section>
    </GuideLayout>
  );
}
