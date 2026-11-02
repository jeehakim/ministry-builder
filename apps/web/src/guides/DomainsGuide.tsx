import { Code, GuideLayout, Section, Steps, Tip } from "./GuideLayout";

export function DomainsGuide() {
  return (
    <GuideLayout
      title="Your own domain"
      intro="Point a domain such as yourchurch.org at your page. Two routes, depending on where the page is hosted."
    >
      <Section title="Before you start">
        <p>
          You need a domain you own at a registrar (Namecheap, GoDaddy, Google Domains, Cloudflare Registrar, and so on) and the login to manage
          its DNS records. If you don't own one yet, a <Code>.org</Code> costs about $11 a year; Cloudflare Registrar sells at cost.
        </p>
        <Tip>
          DNS changes usually take a few minutes to appear, sometimes up to a day. Nothing breaks while you wait; your <Code>sites.shofar.io</Code>{" "}
          address keeps working.
        </Tip>
      </Section>

      <Section title="Route A: your page is published on Ministry Sites">
        <Steps
          items={[
            <>Open <strong>Publish</strong> and scroll to <strong>Custom domain</strong>. Enter your domain, for example <Code>yourchurch.org</Code>, and add it as the main domain.</>,
            <>The panel shows one DNS record to create at your registrar: a <strong>CNAME</strong> from your domain to <Code>sites.shofar.io</Code>. Copy it exactly.</>,
            <>At your registrar, open DNS settings and add that record. If the registrar refuses a CNAME on the bare domain, use an <strong>ALIAS</strong> or <strong>ANAME</strong> record instead, or move the domain's DNS to Cloudflare, which is free.</>,
            <>Back in the panel, click <strong>Refresh</strong>. The status moves from <em>Pending</em> to <em>Issuing certificate</em> to <em>Active</em>. HTTPS is automatic and free.</>,
            <>Want a second domain, such as <Code>yourchurch.foundation</Code>, to redirect to the main one? Add it the same way as a <strong>redirect</strong> and create its CNAME too.</>,
          ]}
        />
        <p>
          Your language pages follow along: <Code>yourchurch.org/en/</Code>, <Code>yourchurch.org/es/</Code>. The contact form and thank-you page work
          on the new domain without any change.
        </p>
      </Section>

      <Section title="Route B: you host the ZIP on your own Cloudflare account">
        <Steps
          items={[
            <>In the Cloudflare dashboard, open <strong>Workers &amp; Pages</strong> and select your site.</>,
            <>Go to <strong>Settings</strong>, then <strong>Domains &amp; Routes</strong>, and add your domain as a custom domain.</>,
            <>If the domain's DNS is already on Cloudflare, that is all; the record and certificate are created for you. If it is elsewhere, Cloudflare shows the record to add at your registrar, or you can move the domain's DNS to Cloudflare (free).</>,
          ]}
        />
      </Section>

      <Section title="Checking it worked">
        <p>
          Open your domain in a private browser window. If you still see your registrar's parking page, DNS has not propagated yet; wait and try
          again. If you see a certificate warning, the certificate is still being issued; it clears on its own. Anything else, write to us from the
          app and include your domain name.
        </p>
      </Section>
    </GuideLayout>
  );
}
