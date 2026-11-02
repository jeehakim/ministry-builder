import { Link } from "react-router";
import { Code, GuideLayout, Section, Steps, Tip } from "./GuideLayout";

const RESEND_URL = "https://resend.com";

function External({ href, children }: { href: string; children: string }) {
  return (
    <a className="text-brand underline" href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}

export function EmailGuide() {
  return (
    <GuideLayout
      title="Email delivery and your own Resend account"
      intro="Your contact form works out of the box. Connect your own Resend account if you want messages to come from your own domain."
    >
      <Section title="What happens by default">
        <p>
          When a visitor sends a message through your contact form, Ministry Sites emails it to the address in your <strong>Contact</strong> section.
          Every message is also saved under <strong>Messages</strong> in the editor, so nothing is lost if an email goes astray.
        </p>
        <p>You don't have to set anything up for this to work.</p>
      </Section>

      <Section title="When to bring your own Resend account">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>You want the email to come from <strong>your own sending domain</strong>, such as <Code>hello@mail.yourchurch.org</Code>.</li>
          <li>You expect <strong>higher volume</strong> than the shared sender is meant for.</li>
          <li>You want <strong>your own sending reputation</strong>, separate from every other site on the platform.</li>
        </ul>
        <Tip>
          If you only want messages in your inbox, keep the default. Bringing your own account is optional, and you can switch back at any time.
        </Tip>
      </Section>

      <Section title="Set it up">
        <Steps
          items={[
            <>
              Create a free account at <External href={RESEND_URL}>resend.com</External>.
            </>,
            <>
              In Resend, open <strong>Domains</strong> and choose <strong>Add domain</strong>. We recommend a subdomain such as{" "}
              <Code>mail.yourchurch.org</Code>, so your main website and personal email are never affected.
            </>,
            <>
              Resend shows a few DNS records. Add each one at your domain registrar, exactly as written. Look for the DNS settings page at Namecheap, GoDaddy,
              Cloudflare, or wherever you bought the domain.
            </>,
            <>
              Back in Resend, wait until the domain shows <strong>Verified</strong>. This usually takes a few minutes, and sometimes up to a day.
            </>,
            <>
              Open <strong>API Keys</strong> and choose <strong>Create API key</strong>. Choose <strong>Full access</strong>: Ministry Sites checks which of
              your domains are verified before it lets you pick a from address, and a sending-only key cannot read that list. Copy the key; Resend
              shows it once. You can revoke it in Resend at any time.
            </>,
            <>
              Here in Ministry Sites, open one of your sites, click the <strong>gear icon</strong> (Site settings), choose <strong>Email delivery</strong>, and
              paste the key under <strong>Connect your Resend account</strong>. We encrypt it on our server and never show it again.
            </>,
            <>
              Choose the <strong>From address</strong> on your verified domain, for example <Code>hello@mail.yourchurch.org</Code>, and optionally a display
              name such as <Code>Grace Church</Code>. Click <strong>Save</strong>.
            </>,
            <>
              Click <strong>Send a test email</strong>. When it arrives, the status at the top of the page changes to <strong>Your Resend account</strong> and
              your contact form messages use it from then on.
            </>,
          ]}
        />
        <p>
          Prefer to start from the sites list? Open the <strong>⋯</strong> menu on a site card and choose <strong>Settings</strong>, or go back to{" "}
          <Link className="text-brand underline" to="/">your sites</Link>.
        </p>
      </Section>

      <Section title="About your key">
        <p>
          The key is encrypted on our server and never displayed again, only its last four characters. It is used only to send your contact form messages.
          You can revoke it at any time under <strong>API Keys</strong> in Resend, and you can <strong>Disconnect</strong> it here; delivery then returns to
          the platform default.
        </p>
      </Section>

      <Section title="Troubleshooting">
        <h3 className="font-medium">Resend rejected the key</h3>
        <p>
          Check that you copied the whole key, which starts with <Code>re_</Code>, with no spaces. Make sure it hasn't been deleted in Resend, and that it
          was created with <strong>Full access</strong>; a sending-only key is rejected because it cannot list your domains. After several failed
          attempts you will be asked to wait an hour before trying again.
        </p>

        <h3 className="font-medium">The domain is not verified</h3>
        <p>
          The From address has to be on a domain that shows <strong>Verified</strong> in Resend. If none appear on this page, finish the DNS step first: in
          Resend, open <strong>Domains</strong> and check that every record is present at your registrar. Once it shows <strong>Verified</strong>, paste your
          key here again so the list of verified domains is refreshed. Your domains are listed at{" "}
          <External href="https://resend.com/domains">resend.com/domains</External>.
        </p>

        <h3 className="font-medium">The test email failed or didn't arrive</h3>
        <p>
          The error from Resend is shown under the test button. Look in your spam folder first. Then confirm the From address is on a verified domain and the
          key hasn't been revoked. If the message says you have reached a limit, see below. Your contact form messages are always saved in{" "}
          <strong>Messages</strong>, even when an email can't be sent.
        </p>

        <h3 className="font-medium">Free-tier limits</h3>
        <p>
          Resend's free plan allows <strong>3,000 emails a month</strong> and <strong>100 a day</strong>. Past that, emails are rejected until the limit resets or
          you upgrade in Resend. For a typical church or ministry contact form this is plenty.
        </p>
      </Section>
    </GuideLayout>
  );
}
