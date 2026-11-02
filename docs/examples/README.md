# Staff automation example

`bwf-e2e.mjs` drives the whole build-for-them flow through the production API using
the `X-Staff-Token` header: create a site, upload photos, draft three AI variations,
pick one, attach images, publish to `sites.shofar.io/<slug>/`, and transfer the
organization to the customer's account by email.

```bash
STAFF_TOKEN_FILE=~/.ministry-staff-token OWNER_EMAIL=someone@example.org node docs/examples/bwf-e2e.mjs
```

Run once without `PICK` to generate drafts, review them, then rerun with
`PICK=<index> SKIP_DRAFT=1`. The staff token is the Worker secret `STAFF_API_TOKEN`;
it never lives in the repo.
