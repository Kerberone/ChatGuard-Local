# Contributing

Thanks for considering a contribution. Please use GitHub issues for bug reports (browser version, Windows version, extension version, host version, and a reproducible sequence). **Never attach conversation ZIPs, tokens, session cookies or personal data** to a public issue.

To test changes: `go test ./host` and `node --test tests/*.test.cjs`. Keep source-only changes reviewable and do not commit `.exe`, backup ZIPs, personal paths or `config.json`. Any change to backup output should preserve immutable snapshots and explicit `COMPLETO` / `PARZIALE` reporting.

Pull requests should explain motivation, tests performed, and migration impact. Do not claim real-browser compatibility based solely on mocks.
