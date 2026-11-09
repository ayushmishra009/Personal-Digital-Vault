# Repository instructions

- Treat `PERSONAL_DIGITAL_VAULT_MASTER_BUILD_SPEC_v1.1.md` and approved decisions in `docs/DECISIONS.md` as the project authority.
- Implement one approved phase at a time. Do not add application features outside the active phase.
- Never send plaintext vault records, titles, URLs, attachments, passwords, recovery secrets, VEKs, or DEKs to the backend. Never store client encryption keys in environment variables.
- Enforce account ownership, tenant isolation, and authorization at API and database boundaries. Frontend visibility is not authorization.
- Keep CMS payloads declarative and schema-validated. Render only through a finite trusted component registry; do not execute database content, arbitrary HTML, CSS, or scripts.
- Keep cryptographic code centralized in the TypeScript crypto-core package. Do not invent primitives or silently alter protocol decisions. Require vectors, negative tests, and review before security claims.
- Use strict TypeScript, avoid unjustified `any`, and follow idiomatic Go with explicit errors and context propagation.
- Validate untrusted data at every boundary. Do not log secrets, plaintext content, or unrestricted ciphertext payloads.
- Never commit `.env` files, credentials, production secrets, or real personal data. Use synthetic fixtures only.
- Update implementation status, decisions, security notes, and the test plan when architecture or implementation changes.
- Clearly label incomplete shells and prototypes. Do not claim security, zero-knowledge, or production readiness without evidence and independent review.
