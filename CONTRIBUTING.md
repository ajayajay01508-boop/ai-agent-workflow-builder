# Contributing

Thanks for helping improve AI Agent Workflow Builder. Start with the [repository guide](README.md) and [testing notes](agent-workflow-builder/TESTING.md).

## Make a focused change

1. Describe the problem, expected behavior and a minimal reproduction before implementing a fix. Check existing issues and pull requests for duplicates.
2. Create a branch for one coherent change. Keep unrelated formatting or dependency updates separate.
3. Add a regression test for changed behavior where practical. Do not weaken authorization or validation to make a test pass.
4. Run the relevant checks from the root README. Record commands and results in your pull request, including checks you could not run.
5. Explain the user impact, implementation, validation and remaining limitations. Include screenshots for UI changes and redacted examples for API changes.
6. Request review and address feedback before merging. Credit actual collaborators; never add co-authors who did not contribute.

## Local validation

```bash
npm ci --prefix agent-workflow-builder/actions
npm test --prefix agent-workflow-builder/actions
npm ci --prefix agent-workflow-builder/frontend
```

Follow the root README for the frontend build configuration. Placeholder build values do not establish that real external integrations work. Use a disposable development organization and test credentials for integration checks.

## Security and privacy

Never commit tokens, passwords, environment files containing secrets, or personal customer data. Keep organization boundaries enforced in both database permissions and action handlers. Use synthetic inputs for examples. Do not publish exploitable vulnerability details in a public issue; use GitHub private vulnerability reporting if enabled, or contact the maintainer privately first.

## Engineering milestones

These are improvement targets, not completed achievements or promised GitHub badges. Close each only with linked evidence.

- [ ] Record a clean-install setup walkthrough and fix any missing steps.
- [ ] Add a regression case for cross-organization access denial.
- [ ] Test expired or invalid authentication credentials.
- [ ] Verify malformed workflow inputs return useful errors.
- [ ] Test retry exhaustion and document terminal failure behavior.
- [ ] Validate quota boundaries under concurrent execution.
- [ ] Verify an approval cannot be resumed by an unauthorized user.
- [ ] Test duplicate webhook delivery and document idempotency behavior.
- [ ] Verify scheduled triggers in a disposable deployed environment.
- [ ] Document subscription reconnect behavior after a network interruption.
- [ ] Add an accessible keyboard walkthrough for the core UI.
- [ ] Publish a tagged release with setup instructions, validation evidence and known limitations.

## Contribution quality

Useful fixes, reproducible bug reports, documentation improvements and thoughtful reviews are welcome. Avoid empty pull requests, manufactured issues, reciprocal stars or activity created solely to collect badges. GitHub determines achievement eligibility and awards independently.
