# AGENTS.md

- Setup: `npm ci`. Before committing: `npm run check`.
- Behavior is specified in brain-wiki's `docs/design/12-visualizer.md`; change that document
  together with the code, and keep `src/types.ts` in step with the API it describes.
- To ship: commit here, `npm run build` (writes the sibling brain-wiki checkout), then commit
  the bundle in brain-wiki. `npm run verify` confirms the bundle matches this source.
- Note text is untrusted: render it as text (Preact escapes; labels use `textContent`), never
  as HTML or Markdown.
- Test data is synthetic. Never add real personal data or credential-shaped strings.
