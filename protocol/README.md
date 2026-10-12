# Protocol source and packaged copies

`actions.json`, `queries.json`, and `errors.json` in this directory are the
canonical protocol documents. The CLI reads `cli/data/protocol/` because its npm
package must work without the rest of this repository. Those files are generated
copies: edit the documents here, then run `npm run sync:protocol` at the repository
root. The CLI's `prepack` hook also refreshes and validates them before publication.

Run `npm run check:protocol` to check the copies without changing files. Run
`npm run test:protocol` for the checker regression tests. CI runs both so a stale
copy cannot silently hide a source change.

The checker compares literal dispatch names in each of the Yarn, official, and
legacy handler families against the same action/query name set. It supports
switch cases and either spelling of `action.equals(...)`. A family-specific
unsupported action must have a concrete reason in `HANDLER_FAMILIES` in
`scripts/protocol-contract.mjs`. Unknown, unexplained, and obsolete exceptions
fail the check. The four existing channel/effect placeholders remain explicitly
unimplemented; declaring their names is not a claim of runtime support.

This is an action-name and packaging guard, not a Java parser or proof of runtime
compatibility. It does not validate parameter/result types, loader startup,
Mixin application, or whether an implemented action supports every option in
each Minecraft version. Those require focused contract and real-client tests.
Do not replace explicit handlers with computed action names without updating the
guard and its tests.
