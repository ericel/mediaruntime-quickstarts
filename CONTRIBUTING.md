# Contributing

Keep each quickstart small, independently runnable, and aligned with the public OpenAPI contract. Examples must not contain real credentials, private bucket names, signed URLs, customer media, or private worker paths.

Before opening a change:

1. Run the language-specific checks documented in that directory.
2. Run `node scripts/check-openapi.mjs`.
3. Confirm the example uses `source`, supported output aliases or presets, and the canonical ZIP bundle model.
4. Preserve raw request bytes when adding webhook examples.

Branches represent versions or maintenance lines, not programming languages. Add new languages as top-level directories.
